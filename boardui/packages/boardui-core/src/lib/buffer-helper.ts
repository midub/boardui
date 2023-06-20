export const arrayBufferToStream = (ab: ArrayBuffer) => new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(ab));
      controller.close();
    },
  });