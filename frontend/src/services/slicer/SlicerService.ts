import { SliceSettings, SlicerWorkerMessage, SlicerWorkerResponse, SlicerProgress, SlicerResult } from './types';
import SlicerWorker from './SlicerWorker?worker'; // Vite worker import

export class SlicerService {
    private worker: Worker | null = null;
    private onProgress: ((progress: SlicerProgress) => void) | null = null;

    constructor() { }

    public async slice(
        meshData: Float32Array,
        settings: SliceSettings,
        onProgress?: (progress: SlicerProgress) => void
    ): Promise<SlicerResult> {
        return new Promise((resolve, reject) => {
            this.terminate(); // Ensure clean state

            this.worker = new SlicerWorker();
            this.onProgress = onProgress || null;

            this.worker.onmessage = (event: MessageEvent<SlicerWorkerResponse>) => {
                const message = event.data;

                switch (message.type) {
                    case 'PROGRESS':
                        if (this.onProgress) {
                            this.onProgress(message.payload);
                        }
                        break;
                    case 'COMPLETE':
                        resolve(message.payload);
                        this.terminate();
                        break;
                    case 'ERROR':
                        reject(new Error(message.payload));
                        this.terminate();
                        break;
                }
            };

            this.worker.onerror = (error) => {
                reject(error);
                this.terminate();
            };

            const msg: SlicerWorkerMessage = {
                type: 'SLICE',
                payload: { meshData, settings }
            };

            this.worker.postMessage(msg);
        });
    }

    public cancel() {
        if (this.worker) {
            this.worker.postMessage({ type: 'CANCEL' } as SlicerWorkerMessage);
            this.terminate();
        }
    }

    private terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.onProgress = null;
    }
}

export const slicerService = new SlicerService();
