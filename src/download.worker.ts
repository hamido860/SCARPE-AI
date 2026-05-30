import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

self.onmessage = async (event: MessageEvent) => {
  const ctx = self as any;
  const { id, type, payload } = event.data;

  if (type === 'process-single-pdf') {
    const { buffer, originalName, metadata } = payload;
    try {
      let cleanBuffer = buffer;
      try {
        const pdfDoc = await PDFDocument.load(buffer);
        // Clear metadata to ensure anonymity and clean presentation
        pdfDoc.setTitle('');
        pdfDoc.setAuthor('');
        pdfDoc.setSubject('');
        pdfDoc.setKeywords([]);
        pdfDoc.setProducer('');
        pdfDoc.setCreator('');
        cleanBuffer = await pdfDoc.save();
      } catch (e) {
        console.warn('Worker: Failed to clear PDF metadata', e);
      }

      // Generate formatted safe name
      let degreeSlug = '';
      if (metadata?.url) {
        try {
          const urlObj = new URL(metadata.url);
          const pathSegments = urlObj.pathname.split('/').filter(Boolean);
          if (pathSegments.length > 0) {
            degreeSlug = decodeURIComponent(pathSegments[pathSegments.length - 1]);
          }
        } catch (e) {}
      }

      // Format clean parts
      const cleanRegex = /[^\p{L}\p{N}\s_-]/gu;
      const safeTitle = metadata?.title ? metadata.title.replace(cleanRegex, '').replace(/\s+/g, '_').substring(0, 30) : '';
      const safeCountry = metadata?.country ? metadata.country.replace(cleanRegex, '').replace(/\s+/g, '_') : '';
      const safeDegree = degreeSlug.replace(cleanRegex, '').replace(/\s+/g, '_');

      let prefix = [safeDegree, safeCountry, safeTitle].filter(Boolean).join('_');
      if (prefix) prefix += '_';
      
      let cleanName = originalName;
      try { cleanName = decodeURIComponent(cleanName); } catch (e) {}
      cleanName = cleanName.replace(/[<>:"/\\|?*]/g, '_');
      if (!cleanName.toLowerCase().endsWith('.pdf')) cleanName += '.pdf';
      
      let fileId = 'uuid-fallback';
      try {
        fileId = crypto.randomUUID();
      } catch (e) {
        fileId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      }

      const finalName = `${prefix}levelspace.ma_${fileId}_${cleanName}`;

      ctx.postMessage({
        id,
        type: 'success',
        payload: { buffer: cleanBuffer, filename: finalName }
      }, [cleanBuffer]);
    } catch (err: any) {
      ctx.postMessage({
        id,
        type: 'error',
        error: err.message || 'Unknown error during single PDF processing'
      });
    }
  }

  else if (type === 'generate-zip') {
    const { files } = payload; // Array of { filename: string, buffer: ArrayBuffer }
    try {
      const zip = new JSZip();
      
      // Since it's in a worker, we can afford to process everything sequentially or concurrently with JSZip
      for (const file of files) {
        zip.file(file.filename, file.buffer);
      }

      const zipBuffer = await zip.generateAsync({ 
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      ctx.postMessage({
        id,
        type: 'success',
        payload: { zipBuffer }
      }, [zipBuffer]);
    } catch (err: any) {
      ctx.postMessage({
        id,
        type: 'error',
        error: err.message || 'Unknown error during ZIP generation'
      });
    }
  }
};
