import { Buffer } from 'buffer';

(window as unknown as { global: typeof window; Buffer: typeof Buffer }).global = window;
(window as unknown as { global: typeof window; Buffer: typeof Buffer }).Buffer = Buffer;
