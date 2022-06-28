# @balsahq/glider-aws

## 0.2.2

### Patch Changes

- 774ca91: Add `grantApiAccess` method, which grants the passed principal access to the Glider API
- 9410acf: Enable DynamoDB point-in-time recovery by default, and make it configurable
- 771c56c: Make worker VPC configurable

## 0.2.1

## 0.2.0

### Minor Changes

- b2a586c: Support customizable worker logging configuration
- b2a586c: Load runner image from Docker Hub
- b2a586c: Migrate from Serverless Stack to raw CDK

### Patch Changes

- 255da59: Export `GliderStack` and `Service`
- 8267fe6: Move CDK to `peerDependencies`
- 2c739d5: Expose service properties on `GliderStack`
