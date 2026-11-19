import type { Settings } from '../domain/types';
import type { ActivitySource } from './ActivitySource';
import { demoSource } from './demo';
import { healthConnectSource } from './healthConnect';

export const sourceFor = (s: Pick<Settings, 'dataSource'>): ActivitySource =>
  s.dataSource === 'demo' ? demoSource : healthConnectSource;
