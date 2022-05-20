import type { AWSError } from 'aws-sdk';

export function assertIsAWSError(e: unknown): asserts e is AWSError {
  if (!e) {
    throw new Error(`expected 'AWSError', got 'null'!`);
  } else if (typeof e !== 'object') {
    throw new Error(`expected 'AWSError', got '${typeof e}'!`);
  } else if (!('code' in e)) {
    throw new Error(
      `expected 'AWSError', got object with missing 'code' property!`
    );
  } else if (!('message' in e)) {
    throw new Error(
      `expected 'AWSError', got object with missing 'message' property!`
    );
  }
}
