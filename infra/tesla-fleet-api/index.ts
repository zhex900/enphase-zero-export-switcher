import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";

const cfg = new pulumi.Config();

const allowedUsers = cfg.require("ALLOWED_USERS");
const clientId = cfg.require("CLIENT_ID");
const clientSecret = cfg.requireSecret("CLIENT_SECRET");
const audience = cfg.get("AUDIENCE") || "https://fleet-api.prd.na.vn.cloud.tesla.com";
const locale = cfg.get("LOCALE") || "en-US";
const scope =
  cfg.get("SCOPE") ||
  "openid user_data vehicle_device_data vehicle_cmds vehicle_charging_cmds energy_device_data energy_cmds offline_access";

// DynamoDB tables
const sessionsTable = new aws.dynamodb.Table("sessions", {
  billingMode: "PAY_PER_REQUEST",
  hashKey: "sid",
  attributes: [{ name: "sid", type: "S" }],
  ttl: { attributeName: "ttl", enabled: true },
});

const tokensTable = new aws.dynamodb.Table("tokens", {
  billingMode: "PAY_PER_REQUEST",
  hashKey: "username",
  attributes: [{ name: "username", type: "S" }],
});

const keysTable = new aws.dynamodb.Table("keys", {
  billingMode: "PAY_PER_REQUEST",
  hashKey: "id",
  attributes: [{ name: "id", type: "S" }],
});

// IAM role for Lambdas
const lambdaRole = new aws.iam.Role("lambdaRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
});

new aws.iam.RolePolicyAttachment("lambdaBasicExecAttach", {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

const ddbPolicy = new aws.iam.Policy("ddbAccessPolicy", {
  policy: pulumi
    .output({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "dynamodb:PutItem",
            "dynamodb:GetItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
          ],
          Resource: [sessionsTable.arn, tokensTable.arn, keysTable.arn],
        },
      ],
    })
    .apply(JSON.stringify),
});

new aws.iam.RolePolicyAttachment("ddbAccessAttach", {
  role: lambdaRole.name,
  policyArn: ddbPolicy.arn,
});

// HTTP API Gateway
const httpApi = new aws.apigatewayv2.Api("api", {
  protocolType: "HTTP",
});

// Helper to create function with common settings
function createLambda(name: string, handler: string) {
  return new aws.lambda.Function(name, {
    runtime: "nodejs20.x",
    role: lambdaRole.arn,
    handler: handler,
    memorySize: 256,
    timeout: 10,
    code: new pulumi.asset.AssetArchive({
      ".": new pulumi.asset.FileArchive(
        path.join(process.cwd(), "..", "..", "src", "functions", "dist"),
      ),
    }),
    environment: {
      variables: {
        ALLOWED_USERS: allowedUsers,
        CLIENT_ID: clientId,
        CLIENT_SECRET: clientSecret,
        AUDIENCE: audience,
        LOCALE: locale,
        SCOPE: scope,
        DOMAIN: httpApi.apiEndpoint.apply((u) => new URL(u).hostname.toLowerCase()),
        SESSIONS_TABLE: sessionsTable.name,
        TOKENS_TABLE: tokensTable.name,
        KEYS_TABLE: keysTable.name,
      },
    },
  });
}

const rootFn = createLambda("root", "handlers/root.handler");
const callbackFn = createLambda("teslaCallback", "handlers/tesla-callback.handler");
const pubKeyFn = createLambda("publicKey", "handlers/public.handler");
const privKeyFn = createLambda("privateKey", "handlers/private.handler");

function addRoute(name: string, routeKey: string, fn: aws.lambda.Function) {
  const integration = new aws.apigatewayv2.Integration(`${name}Integration`, {
    apiId: httpApi.id,
    integrationType: "AWS_PROXY",
    integrationUri: fn.arn,
    payloadFormatVersion: "2.0",
    integrationMethod: "POST",
  });

  new aws.apigatewayv2.Route(`${name}Route`, {
    apiId: httpApi.id,
    routeKey: routeKey,
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  new aws.lambda.Permission(`${name}Perm`, {
    action: "lambda:InvokeFunction",
    function: fn.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${httpApi.executionArn}/*/*`,
  });
}

addRoute("root", "GET /", rootFn);
addRoute("callback", "GET /tesla-callback", callbackFn);
addRoute("pubkey", "GET /.well-known/appspecific/com.tesla.3p.public-key.pem", pubKeyFn);
addRoute("privkey", "GET /.well-known/appspecific/com.tesla.3p.private-key.pem", privKeyFn);

new aws.apigatewayv2.Stage("prod", {
  apiId: httpApi.id,
  name: "$default",
  autoDeploy: true,
});

export const apiUrl = httpApi.apiEndpoint;
export const tokensTableName = tokensTable.name;
export const tokensTableArn = tokensTable.arn;
