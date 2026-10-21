let libraryPromise;

// Places (New): https://developers.google.com/maps/documentation/javascript/place-autocomplete-data
export function loadGoogleAddressLibrary(apiKey, { windowObject = globalThis.window, documentObject = globalThis.document } = {}) {
  if (!apiKey) return Promise.resolve(null);
  if (windowObject?.google?.maps?.importLibrary) return windowObject.google.maps.importLibrary("places");
  if (!windowObject || !documentObject) return Promise.resolve(null);
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = documentObject.createElement("script");
      const callback = "__workorderGoogleAddressReady";
      const timeout = windowObject.setTimeout(() => fail(), 15000);
      function cleanup() { windowObject.clearTimeout(timeout); delete windowObject[callback]; }
      function fail() { cleanup(); script.remove(); reject(new Error("Address suggestions unavailable.")); }
      windowObject[callback] = () => {
        cleanup();
        if (!windowObject.google?.maps?.importLibrary) { fail(); return; }
        windowObject.google.maps.importLibrary("places").then(resolve, reject);
      };
      script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key: apiKey, v: "weekly", loading: "async", callback })}`;
      script.async = true;
      script.onerror = fail;
      documentObject.head.appendChild(script);
    }).catch((error) => { libraryPromise = undefined; throw error; });
  }
  return libraryPromise;
}

export function createGoogleAddressSession(library) {
  let token;
  return {
    async predict(input) {
      token ||= new library.AutocompleteSessionToken();
      const result = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: token });
      return (result.suggestions || []).filter((entry) => entry.placePrediction).map((entry) => ({
        label: entry.placePrediction.text.toString(), prediction: entry.placePrediction,
      }));
    },
    async resolve(suggestion) {
      token = undefined;
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress"] });
      return place.formattedAddress || "";
    },
    reset() { token = undefined; },
  };
}
