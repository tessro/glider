#!/usr/bin/env node

import { App } from 'aws-cdk-lib';

import { GliderStack } from '../src/infrastructure/stack.js';

const app = new App();

new GliderStack(app, 'GliderStack', {});
