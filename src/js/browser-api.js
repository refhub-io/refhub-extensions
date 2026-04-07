const browserLike = globalThis.browser ?? globalThis.chrome;

function wrapAsync(namespace, method) {
  return (...args) =>
    new Promise((resolve, reject) => {
      namespace[method](...args, (result) => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result);
      });
    });
}

function wrapMaybePromise(namespace, method) {
  if (!namespace?.[method]) {
    return undefined;
  }

  if (globalThis.browser?.runtime?.id) {
    return namespace[method].bind(namespace);
  }

  return wrapAsync(namespace, method);
}

export const browserApi = {
  runtime: {
    sendMessage: wrapMaybePromise(browserLike.runtime, "sendMessage"),
    openOptionsPage: wrapMaybePromise(browserLike.runtime, "openOptionsPage"),
  },
  storage: {
    local: {
      get: wrapMaybePromise(browserLike.storage.local, "get"),
      set: wrapMaybePromise(browserLike.storage.local, "set"),
      remove: wrapMaybePromise(browserLike.storage.local, "remove"),
    },
  },
  tabs: {
    query: wrapMaybePromise(browserLike.tabs, "query"),
    create: wrapMaybePromise(browserLike.tabs, "create"),
  },
  cookies: {
    getAll: wrapMaybePromise(browserLike.cookies, "getAll"),
  },
  scripting: {
    executeScript: wrapMaybePromise(browserLike.scripting, "executeScript"),
  },
};

export async function sendRuntimeMessage(message) {
  const response = await browserApi.runtime.sendMessage(message);
  if (response?.__error) {
    throw new Error(response.__error);
  }
  return response;
}
