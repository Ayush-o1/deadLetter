// Starts an Express app on a random free port so tests can call it with fetch().

/**
 * @param {import('express').Express} app
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.on('error', reject);
  });
}
