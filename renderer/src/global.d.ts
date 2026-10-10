import type { InternPulseApi } from '../../shared/api';

declare global {
  interface Window {
    internpulse: InternPulseApi;
  }
}

export {};
