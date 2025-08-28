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
      ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID: cfg.require(
        "ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID",
      ),
      ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID: cfg.require(
        "ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID",
      ),
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
      ],
    })
    .apply((p) => JSON.stringify(p)),
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
    .apply((p) => JSON.stringify(p)),
});

const schedule = new aws.scheduler.Schedule("tenMinDaytimeSydney", {
  scheduleExpression: "cron(0/10 9-17 ? * * *)",
  scheduleExpressionTimezone: "Australia/Sydney",
  flexibleTimeWindow: { mode: "OFF" },
  target: {
    arn: lambda.arn,
    roleArn: schedulerRole.arn,
  },
});

export const functionName = lambda.name;
export const scheduleArn = schedule.arn;
