import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";

const dynamo = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(dynamo, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function ddbGet<T extends Record<string, unknown>>(
  tableName: string,
  key: Record<string, NativeAttributeValue>,
): Promise<T | null> {
  const out = await ddb.send(new GetCommand({ TableName: tableName, Key: key }));
  return (out.Item as T | undefined) ?? null;
}

export async function ddbPut(
  tableName: string,
  item: Record<string, NativeAttributeValue>,
): Promise<void> {
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
}

export async function ddbDelete(
  tableName: string,
  key: Record<string, NativeAttributeValue>,
): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName, Key: key }));
}
