import { PttSettings, PttState } from "./types";

declare global {
  interface Window {
    stoatPTT: {
      getState(): PttState;
      subscribe(listener: (state: PttState) => void): () => void;
      configure(settings: PttSettings): Promise<PttState>;
      keys: readonly string[];
    };
    stoatPTTMedia: {
      status(): {
        microphones: number;
        transmitting: number;
        clientMuted: boolean;
      };
    };
  }
}
