#!/usr/bin/env node

import 'source-map-support/register';
import { App } from 'aws-cdk-lib';

import { GliderStack } from '../src/infrastructure/stack';

const app = new App();

new GliderStack(app, 'GliderStack', {});
