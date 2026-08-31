import { NativeModule, registerWebModule } from 'expo';

import type { DemoCountResult, DemoPillCounterNativeModule } from './DemoPillCounter.types';

class DemoPillCounterModule extends NativeModule implements DemoPillCounterNativeModule {
  async countObjects(_photoUri: string): Promise<DemoCountResult> {
    return { status: 'unable', reason: 'processing_error' };
  }
}

export default registerWebModule(DemoPillCounterModule, 'DemoPillCounter');
