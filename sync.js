/* BzzOps – Brücke für Cloud-Sync und Windows-App. Wird aus Dart aufgerufen
   (lib/plattform/sync_web.dart).

   - In der Windows-App (BzzOps.exe, WebView2) erledigt die EXE Wählen, Lesen
     und Schreiben der Sync-Datei selbst – ohne die Berechtigungsfrage des
     Browsers nach jedem Start (wie bei Billy Ledger).
   - Im Browser (Chrome/Edge am PC) über die File System Access API: Die
     Sync-Datei wird einmal gewählt, der Datei-Handle liegt in IndexedDB
     („bz-sync"), je Speicher-Key getrennt – mehrere Kunden unter derselben
     Domain kommen sich so nicht in die Quere. */
(function () {
  var webview = window.chrome && window.chrome.webview;

  /* ---------------- Windows-App ---------------- */
  var offen = {}, naechsteId = 1;
  if (webview) {
    webview.addEventListener("message", function (e) {
      var d = e.data;
      if (d && d.typ === "antwort" && offen[d.id]) {
        offen[d.id](d.ok ? d.wert : null);
        delete offen[d.id];
      }
    });
  }
  function anExe(nachricht) {
    return new Promise(function (res) {
      var id = String(naechsteId++);
      offen[id] = res;
      nachricht.id = id;
      webview.postMessage(nachricht);
    });
  }
  window.bzzHuelle = {
    aktiv: !!webview,
    melden: function (obj) { if (webview) webview.postMessage(obj); },
  };

  /* ---------------- Browser ---------------- */
  function db() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open("bz-sync", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("handles"); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  async function handleLaden(key) {
    try {
      var d = await db();
      return await new Promise(function (res) {
        var rq = d.transaction("handles", "readonly").objectStore("handles").get(key);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    } catch (e) { return null; }
  }
  async function handleSpeichern(key, handle) {
    var d = await db();
    await new Promise(function (res, rej) {
      var tx = d.transaction("handles", "readwrite");
      if (handle) tx.objectStore("handles").put(handle, key); else tx.objectStore("handles").delete(key);
      tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
    });
  }

  var browser = {
    moeglich: function () { return !!window.showSaveFilePicker; },
    /* Datei wählen – liefert den Dateinamen oder null (abgebrochen). */
    verbinden: async function (key, vorschlag) {
      try {
        var h = await window.showSaveFilePicker({
          suggestedName: vorschlag,
          types: [{ description: "BzzOps Sync-Datei (JSON)", accept: { "application/json": [".json"] } }],
        });
        await handleSpeichern(key, h);
        return h.name;
      } catch (e) { return null; }
    },
    name: async function (key) { var h = await handleLaden(key); return h ? h.name : null; },
    /* "granted" | "prompt" | "denied" | "none"; anfragen=true nur nach einem Klick möglich. */
    berechtigung: async function (key, anfragen) {
      var h = await handleLaden(key);
      if (!h) return "none";
      try {
        var p = await h.queryPermission({ mode: "readwrite" });
        if (p === "granted" || !anfragen) return p;
        return await h.requestPermission({ mode: "readwrite" });
      } catch (e) { return "denied"; }
    },
    lesen: async function (key) {
      var h = await handleLaden(key);
      if (!h) return null;
      try { return await (await h.getFile()).text(); } catch (e) { return null; }
    },
    schreiben: async function (key, inhalt) {
      var h = await handleLaden(key);
      if (!h) return false;
      try {
        if ((await h.queryPermission({ mode: "readwrite" })) !== "granted") return false;
        var w = await h.createWritable();
        await w.write(new Blob([inhalt], { type: "application/json" }));
        await w.close();
        return true;
      } catch (e) { return false; }
    },
    trennen: async function (key) { try { await handleSpeichern(key, null); } catch (e) { /* egal */ } },
  };

  var exe = {
    moeglich: function () { return true; },
    verbinden: function (key, vorschlag) { return anExe({ typ: "sync", aktion: "verbinden", key: key, vorschlag: vorschlag }); },
    name: function (key) { return anExe({ typ: "sync", aktion: "name", key: key }); },
    berechtigung: async function (key) {
      return (await anExe({ typ: "sync", aktion: "name", key: key })) ? "granted" : "none";
    },
    lesen: function (key) { return anExe({ typ: "sync", aktion: "lesen", key: key }); },
    schreiben: async function (key, inhalt) {
      return (await anExe({ typ: "sync", aktion: "schreiben", key: key, inhalt: inhalt })) === true;
    },
    trennen: function (key) { return anExe({ typ: "sync", aktion: "trennen", key: key }); },
  };

  window.bzzSync = webview ? exe : browser;
})();
