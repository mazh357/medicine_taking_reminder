import { NativeModule, requireNativeModule } from 'expo';

import type { DemoPillCounterNativeModule } from './DemoPillCounter.types';

declare class DemoPillCounterModule extends NativeModule implements DemoPillCounterNativeModule {
  countObjects(photoUri: string): Promise<import('./DemoPillCounter.types').DemoCountResult>;
}

export default requireNativeModule<DemoPillCounterModule>('DemoPillCounter');
