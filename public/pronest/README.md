These files are served by the CRM for local PDF extraction and scanned-page OCR.
The browser loads them from this directory; the PDF and its images are not sent
to an external OCR service.

- `pdf.worker.min.mjs`: `pdfjs-dist` 5.7.284, license in `pdfjs-LICENSE.txt`.
- `worker.min.js`: `tesseract.js` 6.0.1, license in `tesseract-LICENSE.md`.
- `tesseract-core-lstm*` and `tesseract-core-simd-lstm*`: `tesseract.js-core` 6.1.2, license in `tesseract-core-LICENSE.txt`.
- `eng.traineddata.gz` and `rus.traineddata.gz`: Tesseract tessdata_fast English and Russian models, from `https://github.com/tesseract-ocr/tessdata_fast` (Apache 2.0).

The traineddata files were downloaded from the project's `main` branch for this
feature. Their compressed SHA-256 values are:

```
eng.traineddata.gz  9addedf9a3203b82581bea9c5dfdbd58e41e4ee3713cbcaf189b9eeff099f855
rus.traineddata.gz  4400581bf1a20ab514a60eb25e8573a82f72c48e6d5c51b39f4676e35d040d01
```
