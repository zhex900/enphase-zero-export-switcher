import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";

const cfg = new pulumi.Config();

// DynamoDB table to track current Enphase grid profile state
const table = new aws.dynamodb.Table("enphase-solar", {
  name: "enphase-solar",
  billingMode: "PAY_PER_REQUEST",
  attributes: [{ name: "systemId", type: "S" }],
  hashKey: "systemId",
});

// Build an AWS Lambda using Node.js with esbuild and point to src/lambda.handler
const role = new aws.iam.Role("lambdaRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
});

new aws.iam.RolePolicyAttachment("lambdaBasicExec", {
  role: role.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

// Reference Tesla stack to get tokens table (must be <org>/<project>/<stack>)
const teslaStack = new pulumi.StackReference(cfg.require("TESLA_STACK"));
const tokensTableName = teslaStack.getOutput("tokensTableName");
const tokensTableArn = teslaStack.getOutput("tokensTableArn");

// Compute Tesla scheduler ARN deterministically (uses default group and fixed name)
const accountId = aws.getCallerIdentityOutput({}).accountId;
const region = pulumi.output(aws.config.region || "ap-southeast-2");
const teslaSchedulerPhysicalName = "everyMinuteTeslaOnly";
const teslaSchedulerArnValue = pulumi.interpolate`arn:aws:scheduler:${region}:${accountId}:schedule/default/${teslaSchedulerPhysicalName}`;

const lambda = new aws.lambda.Function("enphaseSwitcher", {
  runtime: "nodejs20.x",
  architectures: ["arm64"],
  role: role.arn,
  handler: "index.handler",
  timeout: 60,
  memorySize: 256,
  environment: {
    variables: {
      AMBER_TOKEN: cfg.requireSecret("AMBER_TOKEN"),
      AMBER_SITE_ID: cfg.require("AMBER_SITE_ID"),
      ENPHASE_TABLE_NAME: table.name,
      ENPHASE_EMAIL: cfg.requireSecret("ENPHASE_EMAIL"),
      ENPHASE_PASSWORD: cfg.requireSecret("ENPHASE_PASSWORD"),
      ENPHASE_SYSTEM_ID: cfg.require("ENPHASE_SYSTEM_ID"),
      ENPHASE_SERIAL_NUMBER: cfg.require("ENPHASE_SERIAL_NUMBER"),
      ENPHASE_PART_NUMBER: cfg.require("ENPHASE_PART_NUMBER"),
      TESLA_CLIENT_ID: cfg.require("TESLA_CLIENT_ID"),
      TESLA_CLIENT_SECRET: cfg.require("TESLA_CLIENT_SECRET"),
      ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID: cfg.require(
        "ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID",
      ),
      ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID: cfg.require(
        "ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID",
      ),
      TESLA_TOKENS_TABLE: tokensTableName.apply(String),
      TESLA_SCHEDULER_ARN: teslaSchedulerArnValue,
    },
  },
  code: new pulumi.asset.AssetArchive({
    "index.js": new pulumi.asset.FileAsset(path.join(process.cwd(), "..", "dist", "index.js")),
  }),
});

// Allow Lambda to access the DynamoDB table
new aws.iam.RolePolicy("lambdaDynamoAccess", {
  role: role.id,
  policy: pulumi
    .output({
      Version: "2012-10-17",
      Statement: [
        {
          Action: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DescribeTable",
          ],
          Effect: "Allow",
          Resource: table.arn,
        },
        {
          Action: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DescribeTable",
          ],
          Effect: "Allow",
          Resource: tokensTableArn,
        },
      ],
    })
    .apply(JSON.stringify),
});

// Schedule using EventBridge Scheduler in Australia/Sydney timezone
const schedulerRole = new aws.iam.Role("schedulerRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "scheduler.amazonaws.com",
  }),
});

new aws.iam.RolePolicy("schedulerInvokeLambda", {
  role: schedulerRole.id,
  policy: pulumi
    .output({
      Version: "2012-10-17",
      Statement: [
        {
          Action: ["lambda:InvokeFunction"],
          Effect: "Allow",
          Resource: lambda.arn,
        },
      ],
    })
    .apply(JSON.stringify),
});

const schedule = new aws.scheduler.Schedule("tenMinDaytimeSydney", {
  scheduleExpression: "cron(0/15 8-18 ? * * *)",
  scheduleExpressionTimezone: "Australia/Sydney",
  flexibleTimeWindow: { mode: "OFF" },
  target: {
    arn: lambda.arn,
    roleArn: schedulerRole.arn,
  },
});

// Disabled EventBridge Scheduler to trigger every minute and skip Enphase
const teslaScheduler = new aws.scheduler.Schedule("everyMinuteTeslaOnly", {
  name: teslaSchedulerPhysicalName,
  scheduleExpression: "rate(1 minute)",
  flexibleTimeWindow: { mode: "OFF" },
  state: "DISABLED",
  target: {
    arn: lambda.arn,
    roleArn: schedulerRole.arn,
    input: JSON.stringify({ skipEnphase: true }),
  },
});

// Allow the Lambda to enable/disable the Tesla scheduler
new aws.iam.RolePolicy("lambdaSchedulerAccess", {
  role: role.id,
  policy: pulumi
    .output({
      Version: "2012-10-17",
      Statement: [
        {
          Action: ["scheduler:UpdateSchedule", "scheduler:GetSchedule"],
          Effect: "Allow",
          Resource: teslaScheduler.arn,
        },
      ],
    })
    .apply(JSON.stringify),
});

// Allow Lambda role to pass the Scheduler's execution role when updating the schedule target
new aws.iam.RolePolicy("lambdaCanPassSchedulerRole", {
  role: role.id,
  policy: pulumi
    .output({
      Version: "2012-10-17",
      Statement: [
        {
          Action: ["iam:PassRole"],
          Effect: "Allow",
          Resource: schedulerRole.arn,
          Condition: {
            StringEquals: {
              "iam:PassedToService": "scheduler.amazonaws.com",
            },
          },
        },
      ],
    })
    .apply(JSON.stringify),
});

export const functionName = lambda.name;
export const scheduleArn = schedule.arn;
export const teslaSchedulerArn = teslaScheduler.arn;
