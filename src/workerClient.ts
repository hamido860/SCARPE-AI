// @ts-ignore
import DownloadWorker from './download.worker?worker';

interface WorkerRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

class DownloadWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, WorkerRequest>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new DownloadWorker();
      this.worker.onmessage = (event) => {
        const { id, type, payload, error } = event.data;
        const request = this.pendingRequests.get(id);
        if (!request) return;

        this.pendingRequests.delete(id);

        if (type === 'success') {
          request.resolve(payload);
        } else {
          request.reject(new Error(error || 'Worker execution failed'));
        }
      };

      this.worker.onerror = (error) => {
        console.error('DownloadWorker encountered an error:', error);
        // Reject all outstanding requests on worker crash
        for (const [id, request] of this.pendingRequests.entries()) {
          request.reject(new Error('Worker encountered an unhandled error: ' + error.message));
          this.pendingRequests.delete(id);
        }
        this.terminate();
      };
    }
    return this.worker;
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  public processPdf(buffer: ArrayBuffer, originalName: string, metadata?: any): Promise<{ buffer: ArrayBuffer; filename: string }> {
    const worker = this.getWorker();
    const id = this.generateId();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      // Transfer the buffer to the worker so that we avoid copying memory
      worker.postMessage({
        id,
        type: 'process-single-pdf',
        payload: { buffer, originalName, metadata }
      }, [buffer]);
    });
  }

  public generateZip(files: { filename: string; buffer: ArrayBuffer }[]): Promise<{ zipBuffer: ArrayBuffer }> {
    const worker = this.getWorker();
    const id = this.generateId();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // Collect all buffers to transfer them as Transferables
      const buffers = files.map(f => f.buffer);
      
      worker.postMessage({
        id,
        type: 'generate-zip',
        payload: { files }
      }, buffers);
    });
  }
}

export const workerManager = new DownloadWorkerManager();

/**
 * Memory-efficient helper to process a single PDF file on a Web Worker.
 * Modifies metadata without blocking the main browser thread.
 */
export const processPdfViaWorker = async (
  buffer: ArrayBuffer,
  originalName: string,
  metadata?: any
): Promise<{ buffer: ArrayBuffer; filename: string }> => {
  return workerManager.processPdf(buffer.slice(0), originalName, metadata);
};

/**
 * Memory-efficient helper to compile multiple files into a ZIP archive on a Web Worker.
 * Zips files completely off the main thread, keeping the user interface completely fluid.
 */
export const generateZipViaWorker = async (
  files: { filename: string; buffer: ArrayBuffer }[]
): Promise<ArrayBuffer> => {
  const result = await workerManager.generateZip(files);
  return result.zipBuffer;
};
