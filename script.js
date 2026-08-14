import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================================================
   FIREBASE
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyD2ZJqSiJr0uMb52RhdeClKkBNoncT1VdM",
  authDomain: "memory-timeline-f5e32.firebaseapp.com",
  projectId: "memory-timeline-f5e32",
  storageBucket: "memory-timeline-f5e32.firebasestorage.app",
  messagingSenderId: "596383895352",
  appId: "1:596383895352:web:9de8a283e3dc58ee727bcd"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const state = {
  memories: [],
  capsules: [],
  bucketList: [],
  places: [],
  countdowns: [],
  currentMemoryId: "",
  search: "",
  playback: { paused: true, nonce: 0 }
};

const $ = id => document.getElementById(id);

function showModal(id) {
  const el = $(id);
  if (el && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(el).show();
}

function hideModal(id) {
  const el = $(id);
  if (el && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(el).hide();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function safeUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url, window.location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

function setSyncStatus(status, text) {
  if ($("syncIndicator")) $("syncIndicator").className = `sync-dot ${status}`;
  if ($("syncStatusText")) $("syncStatusText").textContent = text;
}

function formatDate(dateString) {
  if (!dateString) return "";
  const d = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateString : d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/* =========================================================
   GOOGLE DRIVE MEDIA STORAGE
   ---------------------------------------------------------
   Firebase remains the database/realtime-sync layer.
   Google Drive stores photos and videos.

   IMPORTANT:
   1. Set GOOGLE_DRIVE_CLIENT_ID below to your OAuth Web Client ID.
   2. The app requests the drive.file scope.
   3. Uploaded media is shared as "Anyone with the link" so
      normal <img> and <video> elements can display it.
      Do not use this mode for highly private media.
   ========================================================= */

const GOOGLE_DRIVE_CLIENT_ID = "1035343182029-e5kbaep69kchplnenphatf83ggqojnsg.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "Memory Vault Media";

const driveState = {
  accessToken: "",
  tokenExpiresAt: 0,
  client: null,
  folderId: "",
  connected: false
};

function openGoogleDriveSetup() {
  const config = getSavedDriveConfig();
  if ($("googleDriveClientIdInput")) $("googleDriveClientIdInput").value =
    config.clientId && !config.clientId.includes("PASTE_YOUR_") ? config.clientId : "";
  if ($("googleDriveFolderNameInput")) $("googleDriveFolderNameInput").value =
    config.folderName || DRIVE_FOLDER_NAME;
  showModal("driveSetupModal");
}
window.openGoogleDriveSetup = openGoogleDriveSetup;

function setDriveStatus(connected, text) {
  const el = $("driveStatus");
  if (!el) return;
  el.innerHTML = connected
    ? `<i class="bi bi-cloud-check me-1"></i>Google Drive: ${escapeHtml(text || "Connected")}`
    : `<i class="bi bi-cloud-slash me-1"></i>Google Drive: ${escapeHtml(text || "Not connected")}`;
  el.classList.toggle("connected", connected);
}

function getSavedDriveConfig() {
  try {
    const savedClientId = (localStorage.getItem("memoryVaultGoogleClientId") || "").trim();
    const validSavedClientId =
      /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(savedClientId);

    return {
      clientId: validSavedClientId ? savedClientId : GOOGLE_DRIVE_CLIENT_ID,
      folderName: localStorage.getItem("memoryVaultGoogleFolderName") || DRIVE_FOLDER_NAME
    };
  } catch {
    return {
      clientId: GOOGLE_DRIVE_CLIENT_ID,
      folderName: DRIVE_FOLDER_NAME
    };
  }
}

function saveDriveConfig(clientId, folderName) {
  localStorage.setItem("memoryVaultGoogleClientId", clientId);
  localStorage.setItem("memoryVaultGoogleFolderName", folderName || DRIVE_FOLDER_NAME);
}

function driveIsAuthorized() {
  return !!driveState.accessToken && Date.now() < driveState.tokenExpiresAt - 30000;
}

let driveTokenPromise = null;
let driveTokenResolve = null;
let driveTokenReject = null;

function initGoogleDriveClient() {
  const config = getSavedDriveConfig();

  if (!config.clientId || config.clientId.includes("PASTE_YOUR_")) {
    setDriveStatus(false, "Client ID required");
    return false;
  }

  if (!window.google?.accounts?.oauth2) {
    setDriveStatus(false, "Google authorization is still loading...");
    return false;
  }

  // IMPORTANT:
  // Keep one permanent GIS callback. Do not replace the callback on every
  // click. Replacing it was fragile and could leave the Drive button with
  // no working completion path after the app's realtime-sync changes.
  driveState.client = google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope: GOOGLE_DRIVE_SCOPE,
    callback: response => {
      if (response?.error) {
        driveState.accessToken = "";
        driveState.tokenExpiresAt = 0;
        driveState.connected = false;
        setDriveStatus(false, "Not connected");

        if (driveTokenReject) {
          const reject = driveTokenReject;
          driveTokenResolve = null;
          driveTokenReject = null;
          driveTokenPromise = null;
          reject(new Error(response.error_description || response.error));
        }
        return;
      }

      if (!response?.access_token) {
        driveState.accessToken = "";
        driveState.tokenExpiresAt = 0;
        driveState.connected = false;
        setDriveStatus(false, "Authorization failed");

        if (driveTokenReject) {
          const reject = driveTokenReject;
          driveTokenResolve = null;
          driveTokenReject = null;
          driveTokenPromise = null;
          reject(new Error("Google did not return an access token."));
        }
        return;
      }

      driveState.accessToken = response.access_token;
      driveState.tokenExpiresAt =
        Date.now() + ((response.expires_in || 3600) * 1000);
      driveState.connected = true;

      try {
        localStorage.setItem("memoryVaultDriveAuthorized", "1");
      } catch {}

      setDriveStatus(true, "Connected");
      ensureDriveFolder().catch(error =>
        console.error("Drive folder setup:", error)
      );

      if (driveTokenResolve) {
        const resolve = driveTokenResolve;
        driveTokenResolve = null;
        driveTokenReject = null;
        driveTokenPromise = null;
        resolve(true);
      }
    },
    error_callback: error => {
      const message =
        error?.message ||
        error?.type ||
        "Google authorization was cancelled or blocked.";

      driveState.connected = false;
      setDriveStatus(false, "Not connected");

      if (driveTokenReject) {
        const reject = driveTokenReject;
        driveTokenResolve = null;
        driveTokenReject = null;
        driveTokenPromise = null;
        reject(new Error(message));
      }
    }
  });

  return true;
}

function requestDriveAccessToken(prompt = "") {
  if (!driveState.client) {
    if (!initGoogleDriveClient()) {
      return Promise.reject(new Error("Google authorization is not ready."));
    }
  }

  if (driveTokenPromise) return driveTokenPromise;

  // The actual requestAccessToken() call is intentionally made immediately
  // by the button handler when possible. Google requires a user gesture for
  // browser token requests.
  driveTokenPromise = new Promise((resolve, reject) => {
    driveTokenResolve = resolve;
    driveTokenReject = reject;

    try {
      driveState.client.requestAccessToken({ prompt });
    } catch (error) {
      driveTokenResolve = null;
      driveTokenReject = null;
      driveTokenPromise = null;
      reject(error);
    }
  });

  return driveTokenPromise;
}

async function connectGoogleDrive(forcePrompt = false) {
  const config = getSavedDriveConfig();

  if (!config.clientId || config.clientId.includes("PASTE_YOUR_")) {
    openGoogleDriveSetup();
    return false;
  }

  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google authorization is still loading. Please try again.");
  }

  if (!driveState.client && !initGoogleDriveClient()) return false;

  if (driveIsAuthorized()) {
    driveState.connected = true;
    setDriveStatus(true, "Connected");
    return true;
  }

  try {
    await requestDriveAccessToken(forcePrompt ? "consent" : "");
    return driveIsAuthorized();
  } catch (error) {
    console.error("Google Drive authorization:", error);
    setDriveStatus(false, "Not connected");
    return false;
  }
}

async function restoreGoogleDriveConnection() {
  const config = getSavedDriveConfig();
  if (!config.clientId || config.clientId.includes("PASTE_YOUR_")) return false;
  if (!window.google?.accounts?.oauth2) return false;

  if (!driveState.client && !initGoogleDriveClient()) return false;
  if (driveIsAuthorized()) return true;

  // Do not request authorization automatically. Google Identity Services
  // requires a user gesture for browser token requests. The Drive button
  // performs the real authorization request.
  return false;
}

async function driveFetch(url, options = {}, retry = true) {
  if (!driveIsAuthorized()) {
    const ok = await connectGoogleDrive(false);
    if (!ok) throw new Error("Google Drive is not connected.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${driveState.accessToken}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry) {
    driveState.accessToken = "";
    driveState.tokenExpiresAt = 0;
    const ok = await connectGoogleDrive(false);
    if (ok) return driveFetch(url, options, false);
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); message = body?.error?.message || message; } catch {}
    throw new Error(`Google Drive: ${message}`);
  }
  return response;
}

async function ensureDriveFolder() {
  if (driveState.folderId) return driveState.folderId;

  const config = getSavedDriveConfig();
  const folderName = config.folderName || DRIVE_FOLDER_NAME;

  const searchUrl =
    `https://www.googleapis.com/drive/v3/files?spaces=drive&` +
    `q=${encodeURIComponent(`name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}` +
    `&fields=files(id,name)&pageSize=10`;

  const searchResponse = await driveFetch(searchUrl);
  const searchData = await searchResponse.json();

  if (searchData.files?.length) {
    driveState.folderId = searchData.files[0].id;
    return driveState.folderId;
  }

  const createResponse = await driveFetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder"
      })
    }
  );

  const folder = await createResponse.json();
  driveState.folderId = folder.id;
  return folder.id;
}

function drivePublicUrl(fileId) {
  return fileId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : "";
}

// Drive's normal download URL is not a reliable <img>/<video> source.
// Retrieve media through the authenticated Drive API and turn it into a local blob URL.
const driveObjectUrls = new Map();

async function getDriveMediaObjectUrl(fileId) {
  if (!fileId) return "";
  if (driveObjectUrls.has(fileId)) return driveObjectUrls.get(fileId);
  const response = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: "GET" }
  );
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  driveObjectUrls.set(fileId, objectUrl);
  return objectUrl;
}

function revokeDriveObjectUrl(fileId) {
  const url = driveObjectUrls.get(fileId);
  if (url) { URL.revokeObjectURL(url); driveObjectUrls.delete(fileId); }
}

async function hydrateDriveMedia(root = document) {
  const nodes = root.querySelectorAll?.('[data-drive-media-id]') || [];
  for (const node of nodes) {
    const fileId = node.dataset.driveMediaId;
    const kind = node.dataset.driveMediaType;
    if (!fileId || node.dataset.hydrated === "1") continue;
    node.dataset.hydrated = "1";
    try {
      const url = await getDriveMediaObjectUrl(fileId);
      if (kind === "image") {
        node.outerHTML = `<img src="${escapeHtml(url)}" class="img-fluid rounded-4 drive-media-image" alt="" loading="lazy">`;
      } else if (kind === "video") {
        node.outerHTML = `<video src="${escapeHtml(url)}" class="w-100 rounded-4 drive-media-video" controls playsinline preload="metadata"></video>`;
      } else if (kind === "audio") {
        node.outerHTML = `<audio src="${escapeHtml(url)}" controls class="w-100 drive-audio-player"></audio>`;
      }
    } catch (error) {
      console.error("Unable to load Google Drive media", fileId, error);
      node.dataset.hydrated = "0";
      node.innerHTML = `<div class="alert alert-light border small mb-0"><i class="bi bi-cloud-exclamation me-1"></i>Google Drive media could not be loaded. Connect Google Drive on this device.</div>`;
    }
  }
}

async function makeDriveFileViewable(fileId) {
  // Keep the old public permission for compatibility. Rendering no longer relies on it.
  try {
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "anyone", role: "reader" })
    });
  } catch (error) {
    console.warn("Public Drive permission was not created; authenticated media will still work.", error);
  }
}

function uploadToDrive(file, folderName, onProgress = () => {}) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!file) return resolve({ url: "", path: "", id: "" });

      const ok = await connectGoogleDrive(false);
      if (!ok) throw new Error("Connect Google Drive before uploading media.");

      const folderId = await ensureDriveFolder();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const finalName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;

      // Step 1: start a Drive resumable upload.
      const initResponse = await driveFetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": file.type || "application/octet-stream",
            "X-Upload-Content-Length": String(file.size)
          },
          body: JSON.stringify({
            name: finalName,
            parents: [folderId],
            mimeType: file.type || "application/octet-stream"
          })
        }
      );

      const sessionUrl = initResponse.headers.get("Location");
      if (!sessionUrl) {
        throw new Error("Google Drive did not return a resumable upload session.");
      }

      // Step 2: upload with XMLHttpRequest so we get byte-level progress.
      const result = await new Promise((resolveUpload, rejectUpload) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", sessionUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

        xhr.upload.onprogress = event => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolveUpload(JSON.parse(xhr.responseText));
            } catch {
              rejectUpload(new Error("Google Drive returned an invalid upload response."));
            }
          } else {
            rejectUpload(new Error(`Google Drive upload failed (${xhr.status}).`));
          }
        };

        xhr.onerror = () => rejectUpload(new Error("Network error while uploading to Google Drive."));
        xhr.onabort = () => rejectUpload(new Error("Google Drive upload was cancelled."));
        xhr.send(file);
      });

      const fileId = result.id;
      if (!fileId) throw new Error("Google Drive did not return a file ID.");

      // Make media directly renderable by <img> and <video>.
      await makeDriveFileViewable(fileId);

      onProgress(100);

      resolve({
        url: drivePublicUrl(fileId),
        path: fileId,       // Keep the existing Firestore field name.
        id: fileId,
        name: result.name || finalName
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function removeDriveFile(fileId) {
  if (!fileId) return;

  // If this is an old Firebase Storage path, Drive will return 400/404;
  // we intentionally ignore it so old memories are not broken.
  try {
    await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    console.warn("Drive cleanup skipped:", error.message);
  }
}

function setUploadProgress(percent, text = "Uploading media...") {
  const wrap = $("memoryUploadProgressWrap");
  if (!wrap) return;
  wrap.classList.remove("d-none");
  $("memoryUploadStatus").textContent = text;
  $("memoryUploadPercent").textContent = `${percent}%`;
  $("memoryUploadProgress").style.width = `${percent}%`;
}

function resetUploadProgress() {
  $("memoryUploadProgressWrap")?.classList.add("d-none");
  if ($("memoryUploadProgress")) $("memoryUploadProgress").style.width = "0%";
}

/* =========================================================
   REALTIME COLLECTION SUBSCRIPTIONS
   ========================================================= */

function subscribe(collectionName, target, orderField, render) {
  /*
    IMPORTANT:
    Do not use a Firestore orderBy() query here.

    The previous version could make a collection listener fail or appear
    empty when existing documents were created by an older version and do
    not contain the same ordering field. That made the whole app look
    disconnected even though Firebase itself was initialized correctly.

    We subscribe directly to the collection, then sort the received data
    locally. This keeps ALL existing documents visible and avoids requiring
    a Firestore index/query shape to match every historical document.
  */
  const unsubscribe = onSnapshot(
    collection(db, collectionName),
    snapshot => {
      state[target] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      if (orderField) {
        state[target].sort((a, b) => {
          const av = a?.[orderField];
          const bv = b?.[orderField];

          // Firestore Timestamp
          if (av?.toMillis && bv?.toMillis) return av.toMillis() - bv.toMillis();

          // Dates / datetime strings
          const ad = Date.parse(String(av ?? ""));
          const bd = Date.parse(String(bv ?? ""));
          if (!Number.isNaN(ad) && !Number.isNaN(bd)) return ad - bd;

          // Numeric values
          if (typeof av === "number" && typeof bv === "number") return av - bv;

          // Normal strings
          return String(av ?? "").localeCompare(String(bv ?? ""));
        });
      }

      render();
      renderAchievements();
      renderSearch();
      setSyncStatus("online", "Synced");
    },
    error => {
      console.error(`${collectionName} realtime error:`, error);
      setSyncStatus("error", `Sync error: ${error.code || error.message}`);
    }
  );

  return unsubscribe;
}

subscribe("memories", "memories", "date", renderTimeline);
subscribe("capsules", "capsules", "unlockDate", renderCapsules);
subscribe("bucketList", "bucketList", "createdAt", renderBucketList);
subscribe("places", "places", "createdAt", renderPlaces);
subscribe("countdowns", "countdowns", "targetDate", renderCountdowns);

window.addEventListener("online", () => {
  setSyncStatus("online", "Reconnecting...");
});

window.addEventListener("offline", () => {
  setSyncStatus("error", "Offline");
});

/* =========================================================
   MEMORY TIMELINE + GALLERY
   ========================================================= */

function getMemoryPhotos(item) {
  const paths = Array.isArray(item?.imagePaths) ? item.imagePaths.filter(Boolean) : [];
  if (!paths.length && item?.imagePath) paths.push(item.imagePath);
  return paths;
}

function getMemoryPhotoUrls(item) {
  const urls = Array.isArray(item?.imageUrls) ? item.imageUrls.filter(Boolean) : [];
  if (!urls.length && item?.image) urls.push(item.image);
  return urls;
}

function getMemoryMediaIds(item) {
  return [
    ...getMemoryPhotos(item).map(id => ({ id, type: "image" })),
    ...(item?.videoPath ? [{ id: item.videoPath, type: "video" }] : [])
  ];
}

function mediaMarkup(item, mode = "card") {
  const media = getMemoryMediaIds(item);
  const first = media[0];
  if (!first) {
    return `<div class="d-flex align-items-center justify-content-center rounded-4 bg-light media-thumb"><i class="bi bi-file-earmark fs-1 text-muted"></i></div>`;
  }
  const placeholder = `<div class="drive-media-placeholder" data-drive-media-id="${escapeHtml(first.id)}" data-drive-media-type="${first.type}"><div class="text-muted small p-4 text-center"><i class="bi ${first.type === "video" ? "bi-camera-video" : "bi-image"} fs-2 d-block mb-1"></i>Loading ${first.type === "video" ? "video" : "photo"}…</div></div>`;
  if (mode === "gallery") return placeholder;
  return placeholder + (media.length > 1 ? `<div class="small text-muted text-center mt-2"><i class="bi bi-images me-1"></i>${media.length} media items — tap to swipe</div>` : "");
}

function renderTimeline() {
  const container = $("timelineContainer");
  if (!container) return;
  container.innerHTML = "";
  if (!state.memories.length) { container.innerHTML = `<div class="text-center py-5 text-muted">No memories yet. Add your first one! 💜</div>`; return; }
  state.memories.forEach((item, index) => {
    const el = document.createElement("div");
    el.className = `timeline-item ${index % 2 === 0 ? "left" : "right"}`;
    const photoCount = getMemoryPhotos(item).length;
    const mediaCount = photoCount + (item.videoPath ? 1 : 0);
    el.innerHTML = `
      <div class="timeline-node" aria-hidden="true"></div>
      <div class="card card-memory shadow-sm rounded-4 text-start w-100 p-0 overflow-hidden">
        <div class="memory-media-wrap">${mediaMarkup(item)}</div>
        <div class="card-body">
          <button type="button" class="btn btn-link p-0 text-decoration-none text-start w-100 memory-open">
            <small class="text-primary fw-bold">${escapeHtml(formatDate(item.date))}</small>
            <h5 class="card-title fw-bold mt-1 mb-1">${escapeHtml(item.title)}</h5>
            <p class="card-text text-muted text-truncate mb-0">${escapeHtml(item.note)}</p>
          </button>
          <div class="mt-2 d-flex flex-wrap gap-2 small text-muted">
            ${photoCount ? `<span><i class="bi bi-images"></i> ${photoCount} Photo${photoCount === 1 ? "" : "s"}</span>` : ''}
            ${item.videoPath ? '<span><i class="bi bi-camera-video"></i> Video</span>' : ''}
            ${(item.audio || item.audioPath) ? '<span><i class="bi bi-music-note"></i> Audio</span>' : ''}
            ${mediaCount > 1 ? '<span><i class="bi bi-arrows-angle-expand"></i> Swipe</span>' : ''}
          </div>
        </div>
      </div>`;
    el.querySelector(".memory-open").addEventListener("click", () => viewMemory(item.id));
    el.querySelector(".memory-media-wrap")?.addEventListener("click", () => viewMemory(item.id));
    container.appendChild(el);
    hydrateDriveMedia(el).catch(console.error);
  });
}

function renderMemoryImagePreviews(files) {
  const box = $("memoryImagePreviewList");
  if (!box) return;
  box.innerHTML = "";
  Array.from(files || []).forEach(file => {
    const col = document.createElement("div");
    col.className = "col-4 col-md-3";
    col.innerHTML = `<img class="img-fluid rounded-3 media-preview" alt="Photo preview">`;
    col.querySelector("img").src = URL.createObjectURL(file);
    box.appendChild(col);
  });
}

function openMemoryEditor(item = null) {
  const form = $("memoryForm");
  form.reset();
  $("memoryId").value = item?.id || "";
  $("memoryFormTitle").textContent = item ? "Edit Memory" : "Add New Memory";
  $("saveMemoryBtn").innerHTML = item ? '<i class="bi bi-cloud-arrow-up me-1"></i>Update Memory' : '<i class="bi bi-cloud-arrow-up me-1"></i>Save Memory';
  $("memoryExistingAudio").value = item?.audio || "";
  $("memoryExistingAudioPath").value = item?.audioPath || "";
  $("memoryExistingImage").value = item?.image || "";
  $("memoryExistingVideo").value = item?.video || "";
  $("memoryExistingImagePath").value = item?.imagePath || "";
  $("memoryExistingVideoPath").value = item?.videoPath || "";
  if (item) {
    $("memTitle").value = item.title || "";
    $("memDate").value = item.date || "";
    $("memNote").value = item.note || "";
    $("memAudio").value = item.audio || "";
    const previewBox = $("memoryImagePreviewList");
    if (previewBox) previewBox.innerHTML = getMemoryPhotos(item).map((id, i) => `<div class="col-4 col-md-3"><div class="small text-muted border rounded-3 p-2 text-center">Existing photo ${i + 1}</div></div>`).join("");
  } else {
    $("memDate").value = new Date().toISOString().slice(0,10);
    $("memoryImagePreviewList").innerHTML = "";
  }
  showModal("memoryModal");
}

document.querySelector('[data-bs-target="#memoryModal"]')?.addEventListener("click", () => openMemoryEditor());

$("memImage")?.addEventListener("change", e => renderMemoryImagePreviews(e.target.files));

$("memoryForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("saveMemoryBtn");
  if (button.disabled) return;
  button.disabled = true;
  const original = button.innerHTML;
  try {
    const id = $("memoryId").value;
    const old = id ? state.memories.find(x => x.id === id) : null;
    const imageFiles = Array.from($("memImage")?.files || []).filter(f => f.type.startsWith("image/"));
    const videoFile = $("memVideo").files?.[0] || null;
    const audioFile = $("memAudioFile").files?.[0] || null;

    let existingPhotos = getMemoryPhotos(old);
    let existingPhotoUrls = getMemoryPhotoUrls(old);
    const uploadedPhotoIds = [];
    const uploadedPhotoUrls = [];
    const totalUploads = imageFiles.length + (videoFile ? 1 : 0) + (audioFile ? 1 : 0);
    let completedUploads = 0;

    const upload = async (file, folder, label) => {
      setUploadProgress(Math.round((completedUploads / Math.max(1,totalUploads)) * 100), `Uploading ${label}...`);
      const result = await uploadToDrive(file, folder, p => {
        const overall = ((completedUploads + p / 100) / Math.max(1,totalUploads)) * 100;
        setUploadProgress(Math.round(overall), `Uploading ${label}...`);
      });
      completedUploads++;
      return result;
    };

    for (let i = 0; i < imageFiles.length; i++) {
      const result = await upload(imageFiles[i], "photos", `photo ${i + 1} of ${imageFiles.length}`);
      uploadedPhotoIds.push(result.path);
      uploadedPhotoUrls.push(result.url);
    }

    let video = { url: old?.video || $("memoryExistingVideo").value || "", path: old?.videoPath || $("memoryExistingVideoPath").value || "" };
    let audio = { url: $("memAudio").value.trim() || old?.audio || $("memoryExistingAudio").value || "", path: old?.audioPath || $("memoryExistingAudioPath").value || "" };
    if (videoFile) video = await upload(videoFile, "videos", "video");
    if (audioFile) audio = await upload(audioFile, "audio", "audio");

    existingPhotos = [...existingPhotos, ...uploadedPhotoIds];
    existingPhotoUrls = [...existingPhotoUrls, ...uploadedPhotoUrls];

    const payload = {
      title: $("memTitle").value.trim(),
      date: $("memDate").value,
      note: $("memNote").value.trim(),
      image: existingPhotoUrls[0] || "",
      imagePath: existingPhotos[0] || "",
      imageUrls: existingPhotoUrls,
      imagePaths: existingPhotos,
      video: video.url || "",
      videoPath: video.path || "",
      audio: audio.url || "",
      audioPath: audio.path || "",
      updatedAt: serverTimestamp()
    };

    if (!payload.title || !payload.date || !payload.note) throw new Error("Please complete the required memory fields.");
    if (id) await updateDoc(doc(db, "memories", id), payload);
    else await addDoc(collection(db, "memories"), { ...payload, createdAt: serverTimestamp() });

    if (old) {
      if (videoFile && old.videoPath && old.videoPath !== video.path) await removeDriveFile(old.videoPath);
      if (audioFile && old.audioPath && old.audioPath !== audio.path) await removeDriveFile(old.audioPath);
    }

    resetUploadProgress();
    hideModal("memoryModal");
    setDriveStatus(true, "Connected");
  } catch (error) {
    console.error("Memory save failed:", error);
    alert(`Unable to save memory.\n\n${error.message}`);
    resetUploadProgress();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
});

let viewerAudioState = { wasPlaying: false, time: 0, memoryId: "" };
let viewerVideo = null;

function memoryMediaList(item) {
  return getMemoryMediaIds(item);
}

function buildMemoryViewer(item) {
  const media = memoryMediaList(item);
  const root = $("memoryModalMedia");
  root.innerHTML = `
    <div id="memoryMediaCarousel" class="carousel slide memory-media-carousel" data-bs-touch="true">
      <div class="carousel-inner">
        ${media.map((m, i) => `<div class="carousel-item ${i === 0 ? "active" : ""}" data-media-id="${escapeHtml(m.id)}" data-media-type="${m.type}">
          <div class="memory-slide-content drive-media-placeholder" data-drive-media-id="${escapeHtml(m.id)}" data-drive-media-type="${m.type}">
            <div class="text-muted p-5 text-center"><i class="bi ${m.type === "video" ? "bi-camera-video" : "bi-image"} fs-1 d-block mb-2"></i>Loading…</div>
          </div>
        </div>`).join("")}
      </div>
      ${media.length > 1 ? `
        <button class="carousel-control-prev" type="button" data-bs-target="#memoryMediaCarousel" data-bs-slide="prev"><span class="carousel-control-prev-icon"></span><span class="visually-hidden">Previous</span></button>
        <button class="carousel-control-next" type="button" data-bs-target="#memoryMediaCarousel" data-bs-slide="next"><span class="carousel-control-next-icon"></span><span class="visually-hidden">Next</span></button>
        <div class="carousel-indicators">${media.map((_, i) => `<button type="button" data-bs-target="#memoryMediaCarousel" data-bs-slide-to="${i}" class="${i === 0 ? "active" : ""}" aria-label="Media ${i + 1}"></button>`).join("")}</div>` : ""}
    </div>
    ${media.length > 1 ? `<div class="text-center small text-muted mt-2">Swipe to move between ${media.length} photos/videos</div>` : ""}`;

  const carouselEl = $("memoryMediaCarousel");
  const carousel = bootstrap.Carousel.getOrCreateInstance(carouselEl, { interval: false, touch: true, ride: false });
  carouselEl.addEventListener("slide.bs.carousel", () => {
    rememberViewerAudioState();
    if (viewerVideo) viewerVideo.pause();
  });
  carouselEl.addEventListener("slid.bs.carousel", async e => {
    const slide = e.relatedTarget;
    viewerVideo = slide.querySelector("video");
    const isVideo = slide.dataset.mediaType === "video";
    if (isVideo) {
      pauseViewerAudio(false, true);
      viewerVideo?.addEventListener("play", () => pauseViewerAudio(false, true), { once: true });
    } else {
      await resumeViewerAudioIfNeeded();
    }
  });
  hydrateDriveMedia(root).then(() => {
    viewerVideo = root.querySelector(".carousel-item.active video");
    attachViewerVideoHandlers(root);
  }).catch(console.error);
}

function attachViewerVideoHandlers(root) {
  root.querySelectorAll("video").forEach(video => {
    video.addEventListener("play", () => pauseViewerAudio(false, true));
    video.addEventListener("ended", () => resumeViewerAudioIfNeeded());
  });
}

function rememberViewerAudioState() {
  const audio = document.querySelector("#memoryModalAudioContainer audio");
  if (!audio) return;
  viewerAudioState.time = Number.isFinite(audio.currentTime) ? audio.currentTime : viewerAudioState.time;
  viewerAudioState.wasPlaying = !audio.paused && !audio.ended;
}

function pauseViewerAudio(sync = true, preserveState = false) {
  const audio = document.querySelector("#memoryModalAudioContainer audio");
  if (!audio) return;
  if (!preserveState) rememberViewerAudioState();
  audio.pause();
  if (sync) publishPlaybackPause();
}

async function resumeViewerAudioIfNeeded() {
  const audio = document.querySelector("#memoryModalAudioContainer audio");
  if (!audio || !viewerAudioState.wasPlaying) return;
  try {
    if (Number.isFinite(viewerAudioState.time)) audio.currentTime = viewerAudioState.time;
    await audio.play();
  } catch (error) {
    console.warn("Audio resume requires a user gesture:", error);
  }
}

async function viewMemory(id) {
  const item = state.memories.find(x => x.id === id);
  if (!item) return;
  state.currentMemoryId = id;
  viewerAudioState = { wasPlaying: false, time: 0, memoryId: id };
  $("memoryModalTitle").textContent = item.title || "Untitled";
  $("memoryModalDate").textContent = formatDate(item.date);
  $("memoryModalNote").textContent = item.note || "";
  buildMemoryViewer(item);
  showModal("viewMemoryModal");

  const audioBox = $("memoryModalAudioContainer");
  const audio = $("memoryModalAudio");
  audioBox.classList.add("d-none");
  audio.pause(); audio.removeAttribute("src"); audio.load();
  audioBox.querySelectorAll(".drive-audio-player").forEach(x => x.remove());

  if (item.audioPath) {
    audio.classList.add("d-none");
    audioBox.classList.remove("d-none");
    const placeholder = document.createElement("div");
    placeholder.dataset.driveMediaId = item.audioPath;
    placeholder.dataset.driveMediaType = "audio";
    audioBox.appendChild(placeholder);
    await hydrateDriveMedia(audioBox);
  } else if (safeUrl(item.audio)) {
    audio.src = safeUrl(item.audio);
    audio.classList.remove("d-none");
    audioBox.classList.remove("d-none");
  }
}

$("memoryModalMedia")?.addEventListener("click", e => {
  if (e.target.closest("button, video, .carousel-control-prev, .carousel-control-next, .carousel-indicators")) return;
  pauseViewerAudio(true);
});

$("memoryModalAudioContainer")?.addEventListener("click", e => {
  if (e.target.closest("audio")) {
    setTimeout(() => {
      const audio = document.querySelector("#memoryModalAudioContainer audio");
      if (audio && !audio.paused) publishPlaybackResume();
    }, 0);
  }
});

$("editMemoryBtn").addEventListener("click", () => {
  const item = state.memories.find(x => x.id === state.currentMemoryId);
  if (!item) return;
  hideModal("viewMemoryModal"); openMemoryEditor(item);
});
$("deleteMemoryBtn").addEventListener("click", async () => {
  const item = state.memories.find(x => x.id === state.currentMemoryId);
  if (!item) return;
  await deleteRecord("memories", item); hideModal("viewMemoryModal");
});

function renderGallery() {
  const container = $("galleryContainer");
  if (!container) return;
  const mediaItems = [];
  state.memories.forEach(x => {
    getMemoryPhotos(x).forEach((path, i) => mediaItems.push({...x, imagePath: path, image: getMemoryPhotoUrls(x)[i] || "", videoPath: "", mediaSource: `Memory photo ${i + 1}`}));
    if (x.videoPath) mediaItems.push({...x, imagePath: "", videoPath: x.videoPath, mediaSource: "Memory video"});
  });
  state.bucketList.filter(x => x.photoPath).forEach(x => mediaItems.push({...x, imagePath: x.photoPath, videoPath: "", mediaSource: "Bucket celebration"}));
  container.innerHTML = mediaItems.length ? mediaItems.map(item => `
    <div class="col-6 col-md-4 col-lg-3 gallery-item"><div class="card border-0 shadow-sm rounded-4 p-2 h-100">
      ${mediaMarkup(item, "gallery")}
      <div class="pt-2 px-1"><div class="fw-semibold text-truncate">${escapeHtml(item.title)}</div><small class="text-muted">${escapeHtml(item.mediaSource || "Media")}</small></div>
    </div></div>`).join("") : `<div class="col-12 text-center text-muted py-5">No photos or videos uploaded yet.</div>`;
  hydrateDriveMedia(container).catch(console.error);
}
$("openGalleryBtn").addEventListener("click", () => { renderGallery(); showModal("galleryModal"); });

/* =========================================================
   CAPSULES / LETTERS
   ========================================================= */

function renderCapsules() {
  const container = $("capsuleContainer");
  if (!container) return;
  const today = new Date(); today.setHours(0,0,0,0);
  container.innerHTML = state.capsules.length ? "" : `<div class="col-12 text-center text-muted py-5">No letters yet.</div>`;

  state.capsules.forEach(item => {
    const unlock = new Date(`${item.unlockDate}T00:00:00`);
    const unlocked = today >= unlock;
    const days = Math.max(0, Math.ceil((unlock - today) / 86400000));
    const col = document.createElement("div");
    col.className = "col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="card capsule-card ${unlocked ? "border-success" : "border-secondary"} shadow-sm rounded-4 h-100 p-3">
        <div class="card-body p-0 d-flex flex-column">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="badge ${unlocked ? "bg-success" : "bg-secondary"}">${unlocked ? "Unlocked" : "Locked"}</span>
            <small class="text-muted">${escapeHtml(item.unlockDate)}</small>
          </div>
          <h5 class="fw-bold">${escapeHtml(item.title)}</h5>
          <p class="text-secondary flex-grow-1" style="white-space:pre-line">${unlocked ? escapeHtml(item.content) : "This letter is still sealed. 💌"}</p>
          ${!unlocked ? `<div class="text-muted small mb-3"><i class="bi bi-lock-fill me-1"></i>${days} day(s) left</div>` : ""}
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-primary rounded-pill flex-fill edit-capsule"><i class="bi bi-pencil"></i> Edit</button>
            <button class="btn btn-sm btn-outline-danger rounded-pill flex-fill delete-capsule"><i class="bi bi-trash"></i> Delete</button>
          </div>
        </div>
      </div>`;
    col.querySelector(".edit-capsule").addEventListener("click", () => openCapsuleEditor(item));
    col.querySelector(".delete-capsule").addEventListener("click", () => deleteRecord("capsules", item));
    container.appendChild(col);
  });
}

function openCapsuleEditor(item = null) {
  $("capsuleForm").reset();
  $("capsuleId").value = item?.id || "";
  $("capsuleFormTitle").textContent = item ? "Edit Letter / Capsule" : "Create Time Capsule / Letter";
  $("saveCapsuleBtn").textContent = item ? "Update Letter" : "Save Letter";
  if (item) {
    $("capTitle").value = item.title || "";
    $("capUnlockDate").value = item.unlockDate || "";
    $("capContent").value = item.content || "";
  }
  showModal("capsuleModal");
}
document.querySelector('[data-bs-target="#capsuleModal"]').addEventListener("click", () => openCapsuleEditor());
$("capsuleForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("capsuleId").value;
  const payload = {
    title: $("capTitle").value.trim(),
    unlockDate: $("capUnlockDate").value,
    content: $("capContent").value.trim(),
    updatedAt: serverTimestamp()
  };
  try {
    if (id) await updateDoc(doc(db, "capsules", id), payload);
    else await addDoc(collection(db, "capsules"), { ...payload, createdAt: serverTimestamp() });
    event.target.reset(); $("capsuleId").value = ""; hideModal("capsuleModal");
  } catch (e) { alert(`Unable to save letter.\n\n${e.message}`); }
});

/* =========================================================
   BUCKET LIST + COMPLETION TRACKING
   ========================================================= */

function renderBucketList() {
  const container = $("bucketListContainer");
  if (!container) return;
  container.innerHTML = state.bucketList.length ? "" : `<div class="col-12 text-center text-muted py-5">No bucket goals yet.</div>`;

  const total = state.bucketList.length;
  const completed = state.bucketList.filter(x => x.completed).length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  $("bucketProgressText").textContent = `${completed} of ${total} goals completed • ${pct}%`;
  $("bucketProgressBar").style.width = `${pct}%`;

  state.bucketList.forEach(item => {
    const col = document.createElement("div");
    col.className = "col-md-6";
    col.innerHTML = `
      <div class="card border-0 shadow-sm rounded-4 h-100 p-3">
        <div class="d-flex align-items-start gap-3">
          <input class="form-check-input fs-5 mt-1 bucket-check" type="checkbox" ${item.completed ? "checked" : ""}>
          <div class="flex-grow-1">
            <span class="badge bg-light text-dark border mb-1">${escapeHtml(item.category)}</span>
            <h6 class="fw-bold mb-1 ${item.completed ? "text-decoration-line-through text-muted" : ""}">${escapeHtml(item.title)}</h6>
            ${item.photoPath ? `<div class="mt-2 drive-media-placeholder rounded-3" data-drive-media-id="${escapeHtml(item.photoPath)}" data-drive-media-type="image"><div class="text-muted small p-3 text-center">Loading celebration photo…</div></div>` : ""}
            <div class="d-flex gap-2 mt-3">
              <button class="btn btn-sm btn-outline-primary rounded-pill edit-bucket"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger rounded-pill delete-bucket"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      </div>`;
    const check = col.querySelector(".bucket-check");
    check.addEventListener("change", () => {
      if (!item.completed) {
        $("completeBucketId").value = item.id;
        showModal("completeBucketModal");
      } else {
        updateDoc(doc(db, "bucketList", item.id), { completed: false, updatedAt: serverTimestamp() });
      }
    });
    col.querySelector(".edit-bucket").addEventListener("click", () => openBucketEditor(item));
    col.querySelector(".delete-bucket").addEventListener("click", () => deleteRecord("bucketList", item));
    container.appendChild(col);
    hydrateDriveMedia(col).catch(console.error);
  });
}

function openBucketEditor(item = null) {
  $("bucketForm").reset();
  $("bucketId").value = item?.id || "";
  $("bucketFormTitle").textContent = item ? "Edit Bucket Goal" : "Add Bucket Goal";
  if (item) { $("bucketTitle").value = item.title || ""; $("bucketCategory").value = item.category || "Travel"; }
  showModal("bucketModal");
}
document.querySelector('[data-bs-target="#bucketModal"]').addEventListener("click", () => openBucketEditor());
$("bucketForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("bucketId").value;
  const payload = { title: $("bucketTitle").value.trim(), category: $("bucketCategory").value, updatedAt: serverTimestamp() };
  try {
    if (id) await updateDoc(doc(db, "bucketList", id), payload);
    else await addDoc(collection(db, "bucketList"), { ...payload, completed: false, photo: "", photoPath: "", createdAt: serverTimestamp() });
    event.target.reset(); $("bucketId").value = ""; hideModal("bucketModal");
  } catch (e) { alert(`Unable to save goal.\n\n${e.message}`); }
});

$("completeBucketForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("completeBucketId").value;
  if (!id) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    let photo = { url: "", path: "" };
    const file = $("completePhoto").files?.[0];
    if (file) photo = await uploadToDrive(file, "bucket-completions");
    const old = state.bucketList.find(x => x.id === id);
    await updateDoc(doc(db, "bucketList", id), {
      completed: true, photo: photo.url, photoPath: photo.path, completedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    if (old?.photoPath && file) await removeDriveFile(old.photoPath);
    event.target.reset(); $("completeBucketId").value = ""; hideModal("completeBucketModal");
  } catch (e) {
    alert(`Unable to complete goal.\n\n${e.message}`);
  } finally { button.disabled = false; }
});

/* =========================================================
   PLACES + GOOGLE MAPS LINKS
   ========================================================= */

function mapsUrl(item) {
  const explicit = safeUrl(item.mapUrl);
  if (explicit) return explicit;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address || item.name || "")}`;
}

function renderPlaces() {
  const container = $("placesContainer");
  if (!container) return;
  container.innerHTML = state.places.length ? "" : `<div class="col-12 text-center text-muted py-5">No places saved yet.</div>`;
  state.places.forEach(item => {
    const col = document.createElement("div");
    col.className = "col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="card place-card border-0 shadow-sm rounded-4 h-100 p-3">
        <div class="d-flex align-items-start gap-3">
          <div class="rounded-circle bg-primary-subtle p-3 text-primary"><i class="bi bi-geo-alt-fill fs-4"></i></div>
          <div class="flex-grow-1">
            <h5 class="fw-bold mb-1">${escapeHtml(item.name)}</h5>
            <p class="text-muted small mb-2">${escapeHtml(item.address)}</p>
            <p class="small text-secondary" style="white-space:pre-line">${escapeHtml(item.notes)}</p>
            <div class="d-flex gap-2 mt-3">
              <a class="btn btn-sm btn-primary rounded-pill flex-fill" target="_blank" rel="noopener" href="${escapeHtml(mapsUrl(item))}">
                <i class="bi bi-google me-1"></i>Google Maps
              </a>
              <button class="btn btn-sm btn-outline-primary rounded-pill edit-place"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger rounded-pill delete-place"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      </div>`;
    col.querySelector(".edit-place").addEventListener("click", () => openPlaceEditor(item));
    col.querySelector(".delete-place").addEventListener("click", () => deleteRecord("places", item));
    container.appendChild(col);
  });
}

function openPlaceEditor(item = null) {
  $("placeForm").reset();
  $("placeId").value = item?.id || "";
  $("placeFormTitle").textContent = item ? "Edit Place" : "Add Place";
  if (item) {
    $("placeName").value = item.name || "";
    $("placeAddress").value = item.address || "";
    $("placeNotes").value = item.notes || "";
    $("placeMapUrl").value = item.mapUrl || "";
  }
  showModal("addPlaceModal");
}
document.querySelectorAll('[data-bs-target="#addPlaceModal"]').forEach(btn => btn.addEventListener("click", () => openPlaceEditor()));
$("placeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("placeId").value;
  const payload = {
    name: $("placeName").value.trim(), address: $("placeAddress").value.trim(),
    notes: $("placeNotes").value.trim(), mapUrl: $("placeMapUrl").value.trim(), updatedAt: serverTimestamp()
  };
  try {
    if (id) await updateDoc(doc(db, "places", id), payload);
    else await addDoc(collection(db, "places"), { ...payload, createdAt: serverTimestamp() });
    event.target.reset(); $("placeId").value = ""; hideModal("addPlaceModal");
  } catch (e) { alert(`Unable to save place.\n\n${e.message}`); }
});

/* =========================================================
   COUNTDOWNS
   ========================================================= */

function countdownParts(target) {
  const diff = new Date(target).getTime() - Date.now();
  const seconds = Math.max(0, Math.floor(diff / 1000));
  return {
    diff, days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60
  };
}

function renderCountdowns() {
  const container = $("countdownsContainer");
  if (!container) return;
  container.innerHTML = state.countdowns.length ? "" : `<div class="col-12 text-center text-muted py-5">No countdowns yet.</div>`;
  state.countdowns.forEach(item => {
    const p = countdownParts(item.targetDate);
    const done = p.diff <= 0;
    const col = document.createElement("div");
    col.className = "col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="card countdown-card border-0 shadow-sm rounded-4 h-100 p-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <span class="badge ${done ? "bg-success" : "bg-danger"}">${done ? "It's time! 🎉" : "Counting down"}</span>
          <small class="text-muted">${escapeHtml(formatDateTime(item.targetDate))}</small>
        </div>
        <h4 class="fw-bold">${escapeHtml(item.title)}</h4>
        <p class="text-secondary">${escapeHtml(item.description)}</p>
        <div class="countdown-number display-6 fw-bold text-danger mb-3" data-countdown="${escapeHtml(item.id)}">
          ${done ? "00d 00h 00m 00s" : `${p.days}d ${String(p.hours).padStart(2,"0")}h ${String(p.minutes).padStart(2,"0")}m ${String(p.seconds).padStart(2,"0")}s`}
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-primary rounded-pill flex-fill edit-countdown"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-sm btn-outline-danger rounded-pill flex-fill delete-countdown"><i class="bi bi-trash"></i> Delete</button>
        </div>
      </div>`;
    col.querySelector(".edit-countdown").addEventListener("click", () => openCountdownEditor(item));
    col.querySelector(".delete-countdown").addEventListener("click", () => deleteRecord("countdowns", item));
    container.appendChild(col);
  });
}

function tickCountdowns() {
  document.querySelectorAll("[data-countdown]").forEach(el => {
    const item = state.countdowns.find(x => x.id === el.dataset.countdown);
    if (!item) return;
    const p = countdownParts(item.targetDate);
    el.textContent = p.diff <= 0 ? "00d 00h 00m 00s" :
      `${p.days}d ${String(p.hours).padStart(2,"0")}h ${String(p.minutes).padStart(2,"0")}m ${String(p.seconds).padStart(2,"0")}s`;
  });
}
setInterval(tickCountdowns, 1000);

function openCountdownEditor(item = null) {
  $("countdownForm").reset();
  $("countdownId").value = item?.id || "";
  $("countdownFormTitle").textContent = item ? "Edit Countdown" : "Add Countdown";
  if (item) {
    $("countdownTitle").value = item.title || "";
    $("countdownDate").value = item.targetDate || "";
    $("countdownDescription").value = item.description || "";
  }
  showModal("addCountdownModal");
}
document.querySelectorAll('[data-bs-target="#addCountdownModal"]').forEach(btn => btn.addEventListener("click", () => openCountdownEditor()));
$("countdownForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("countdownId").value;
  const payload = {
    title: $("countdownTitle").value.trim(), targetDate: $("countdownDate").value,
    description: $("countdownDescription").value.trim(), updatedAt: serverTimestamp()
  };
  try {
    if (id) await updateDoc(doc(db, "countdowns", id), payload);
    else await addDoc(collection(db, "countdowns"), { ...payload, createdAt: serverTimestamp() });
    event.target.reset(); $("countdownId").value = ""; hideModal("addCountdownModal");
  } catch (e) { alert(`Unable to save countdown.\n\n${e.message}`); }
});

/* =========================================================
   ACHIEVEMENTS
   ========================================================= */

function renderAchievements() {
  const container = $("achievementsContainer");
  if (!container) return;

  const totalMedia = state.memories.filter(x => x.image || x.video).length;
  const completed = state.bucketList.filter(x => x.completed).length;
  const achievements = [
    ["first-memory", "First Memory", "Save your first memory.", state.memories.length >= 1, "bi-heart-fill"],
    ["five-memories", "Memory Keeper", "Save 5 memories.", state.memories.length >= 5, "bi-journal-heart-fill"],
    ["media", "Captured Moments", "Add a photo or video.", totalMedia >= 1, "bi-camera-fill"],
    ["five-media", "Storyteller", "Collect 5 media memories.", totalMedia >= 5, "bi-images"],
    ["first-goal", "Dreamer", "Create your first bucket goal.", state.bucketList.length >= 1, "bi-stars"],
    ["goal-complete", "Goal Getter", "Complete your first bucket goal.", completed >= 1, "bi-check-circle-fill"],
    ["three-goals", "Adventure Mode", "Complete 3 bucket goals.", completed >= 3, "bi-trophy-fill"],
    ["letter", "Love Letter", "Create your first letter/capsule.", state.capsules.length >= 1, "bi-envelope-heart-fill"],
    ["place", "Explorer", "Save your first place.", state.places.length >= 1, "bi-geo-alt-fill"],
    ["countdown", "Looking Forward", "Create your first countdown.", state.countdowns.length >= 1, "bi-hourglass-split"]
  ];

  container.innerHTML = achievements.map(a => `
    <div class="col-6 col-md-4 col-lg-3">
      <div class="card achievement-card ${a[3] ? "unlocked" : "locked"} border-0 shadow-sm rounded-4 h-100 p-3 text-center">
        <i class="bi ${a[4]} display-6 ${a[3] ? "text-warning" : "text-secondary"}"></i>
        <h6 class="fw-bold mt-2">${escapeHtml(a[1])}</h6>
        <p class="small text-muted mb-0">${escapeHtml(a[2])}</p>
        <span class="badge ${a[3] ? "bg-warning text-dark" : "bg-light text-secondary"} mt-3">${a[3] ? "Unlocked" : "Locked"}</span>
      </div>
    </div>`).join("");
}

/* =========================================================
   GLOBAL SEARCH
   ========================================================= */

function searchText(item) {
  return Object.values(item).filter(v => typeof v === "string").join(" ").toLowerCase();
}

function renderSearch() {
  const queryText = state.search.trim().toLowerCase();
  const box = $("searchResults");
  if (!queryText) { box.classList.add("d-none"); return; }

  const groups = [
    ["Memory", state.memories, "bi-clock-history"],
    ["Letter", state.capsules, "bi-envelope-paper-heart"],
    ["Bucket Goal", state.bucketList, "bi-check2-square"],
    ["Place", state.places, "bi-geo-alt"],
    ["Countdown", state.countdowns, "bi-calendar-heart"]
  ];

  const matches = [];
  groups.forEach(([type, items, icon]) => items.forEach(item => {
    if (searchText(item).includes(queryText)) matches.push({ type, icon, item });
  }));

  box.classList.remove("d-none");
  box.innerHTML = `
    <div class="card border-0 shadow-sm rounded-4 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold mb-0">Search results</h6><span class="badge bg-primary">${matches.length}</span>
      </div>
      ${matches.length ? matches.map(m => `
        <button class="search-result-card btn btn-light w-100 text-start mb-2 rounded-3" data-type="${escapeHtml(m.type)}" data-id="${escapeHtml(m.item.id)}">
          <i class="bi ${m.icon} text-primary me-2"></i>
          <strong>${escapeHtml(m.item.title || m.item.name || "Untitled")}</strong>
          <small class="text-muted ms-2">${escapeHtml(m.type)}</small>
        </button>`).join("") : `<div class="text-muted small py-2">Nothing found.</div>`}
    </div>`;

  box.querySelectorAll("[data-id]").forEach(btn => btn.addEventListener("click", () => {
    const type = btn.dataset.type, id = btn.dataset.id;
    if (type === "Memory") viewMemory(id);
    if (type === "Letter") { const x = state.capsules.find(i => i.id === id); if (x) openCapsuleEditor(x); }
    if (type === "Bucket Goal") { const x = state.bucketList.find(i => i.id === id); if (x) openBucketEditor(x); }
    if (type === "Place") { const x = state.places.find(i => i.id === id); if (x) openPlaceEditor(x); }
    if (type === "Countdown") { const x = state.countdowns.find(i => i.id === id); if (x) openCountdownEditor(x); }
  }));
}

$("globalSearch").addEventListener("input", e => { state.search = e.target.value; renderSearch(); });

/* =========================================================
   DELETE HELPER
   ========================================================= */

async function deleteRecord(collectionName, item) {
  try {
    await deleteDoc(doc(db, collectionName, item.id));
    for (const photoPath of getMemoryPhotos(item)) await removeDriveFile(photoPath);
    if (item.imagePath && !getMemoryPhotos(item).includes(item.imagePath)) await removeDriveFile(item.imagePath);
    if (item.videoPath) { revokeDriveObjectUrl(item.videoPath); await removeDriveFile(item.videoPath); }
    if (item.audioPath) { revokeDriveObjectUrl(item.audioPath); await removeDriveFile(item.audioPath); }
    if (item.imagePath) revokeDriveObjectUrl(item.imagePath);
    if (item.photoPath) { revokeDriveObjectUrl(item.photoPath); await removeDriveFile(item.photoPath); }
  } catch (e) {
    console.error(e);
    alert(`Unable to delete item.\n\n${e.message}`);
  }
}

/* =========================================================
   PREVIEWS + MODAL RESET
   ========================================================= */

$("memImage")?.addEventListener("change", () => {
  const file = $("memImage").files?.[0];
  const img = $("memoryImagePreview");
  if (!img) return;
  if (!file) { img.classList.add("d-none"); return; }
  img.src = URL.createObjectURL(file);
  img.classList.remove("d-none");
});

$("memVideo")?.addEventListener("change", () => {
  const file = $("memVideo").files?.[0];
  const video = $("memoryVideoPreview");
  if (!video) return;
  if (!file) { video.classList.add("d-none"); return; }
  video.src = URL.createObjectURL(file);
  video.classList.remove("d-none");
});

$("completePhoto")?.addEventListener("change", () => {
  const file = $("completePhoto").files?.[0];
  const img = $("completePhotoPreview");
  if (!img) return;
  if (!file) { img.classList.add("d-none"); return; }
  img.src = URL.createObjectURL(file);
  img.classList.remove("d-none");
});

["memoryModal", "capsuleModal", "bucketModal", "addPlaceModal", "addCountdownModal"].forEach(id => {
  $(id)?.addEventListener("hidden.bs.modal", () => {
    if (id === "memoryModal") {
      $("memoryForm").reset(); $("memoryId").value = ""; $("memoryExistingAudio").value = ""; $("memoryExistingAudioPath").value = ""; resetUploadProgress();
      if ($("memoryImagePreview")) $("memoryImagePreview").classList.add("d-none");
      if ($("memoryImagePreviewList")) $("memoryImagePreviewList").innerHTML = ""; $("memoryVideoPreview").classList.add("d-none");
    }
    if (id === "capsuleModal") $("capsuleId").value = "";
    if (id === "bucketModal") $("bucketId").value = "";
    if (id === "addPlaceModal") $("placeId").value = "";
    if (id === "addCountdownModal") $("countdownId").value = "";
  });
});

setSyncStatus("online", "Connecting...");

/* =========================================================
   LOCAL PLAYBACK CONTROL
   =========================================================
   Playback is intentionally LOCAL to each device.
   Firestore synchronizes memories/media/data, but NOT play/pause,
   currentTime, or video state. This prevents Device B from
   pausing Device A's audio/video.
   ========================================================= */

function publishPlaybackPause() {
  // Playback is deliberately DEVICE-LOCAL.
  // Do NOT write pause/play/currentTime/video state to Firestore.
  // Firestore continues to synchronize memories, letters, goals, places,
  // countdowns, and their media references between all connected devices.
}

function publishPlaybackResume() {
  // Same rule: playback remains local to the device.
}

/* =========================================================
   GOOGLE DRIVE UI
   ========================================================= */

function handleConnectDriveClick(event) {
  event?.preventDefault?.();

  const button = $("connectDriveBtn");
  if (!button || button.dataset.driveBusy === "1") return;

  const config = getSavedDriveConfig();
  if (!config.clientId || config.clientId.includes("PASTE_YOUR_")) {
    openGoogleDriveSetup();
    return;
  }

  // requestAccessToken() must happen from the user's click. Do not put an
  // await before it while GIS is loading, because that can lose the gesture.
  if (!window.google?.accounts?.oauth2) {
    setDriveStatus(false, "Google authorization is still loading...");
    alert("Google authorization is still loading. Please press Connect Google Drive again in a moment.");
    return;
  }

  if (!driveState.client && !initGoogleDriveClient()) {
    alert("Google authorization could not be initialized.");
    return;
  }

  button.dataset.driveBusy = "1";
  button.disabled = true;
  setDriveStatus(false, "Connecting...");

  const finish = () => {
    button.dataset.driveBusy = "0";
    button.disabled = false;
  };

  if (driveIsAuthorized()) {
    setDriveStatus(true, "Connected");
    finish();
    return;
  }

  // This call occurs synchronously from the click path.
  requestDriveAccessToken("consent")
    .then(async () => {
      setDriveStatus(true, "Connected");
      try {
        await ensureDriveFolder();
      } catch (error) {
        console.error("Drive folder setup:", error);
      }
    })
    .catch(error => {
      console.error("Google Drive connection failed:", error);
      setDriveStatus(false, "Not connected");
      alert(`Unable to connect Google Drive.\\n\\n${error.message}`);
    })
    .finally(finish);
}

$("connectDriveBtn")?.addEventListener("click", handleConnectDriveClick);

$("saveDriveSetupBtn")?.addEventListener("click", async () => {
  const clientId = $("googleDriveClientIdInput").value.trim();
  const folderName =
    $("googleDriveFolderNameInput").value.trim() || DRIVE_FOLDER_NAME;

  if (!/^[0-9]+-[a-z0-9_-]+\\.apps\\.googleusercontent\\.com$/i.test(clientId)) {
    alert("Enter your Google OAuth Web Client ID.");
    return;
  }

  saveDriveConfig(clientId, folderName);
  driveState.client = null;
  driveState.accessToken = "";
  driveState.tokenExpiresAt = 0;
  driveState.folderId = "";
  driveState.connected = false;

  hideModal("driveSetupModal");

  try {
    if (!initGoogleDriveClient()) {
      throw new Error("Google authorization is not ready.");
    }

    // This is a click from the setup modal, so it is also a valid user gesture.
    const ok = await connectGoogleDrive(true);
    if (ok) {
      await ensureDriveFolder();
      setDriveStatus(true, "Connected");
    }
  } catch (error) {
    console.error(error);
    alert(`Google Drive setup failed.\\n\\n${error.message}`);
  }
});

/*
 * Google Identity Services is loaded with async/defer.
 * Initialize the token client when the library becomes available, but never
 * automatically request an access token here. Authorization is initiated
 * only by the user's Connect Google Drive button.
 */
function waitForGoogleDrive() {
  if (window.google?.accounts?.oauth2) {
    const config = getSavedDriveConfig();

    if (config.clientId && !config.clientId.includes("PASTE_YOUR_")) {
      initGoogleDriveClient();
      setDriveStatus(false, "Ready to connect");
    } else {
      setDriveStatus(false, "Client ID required");
    }
    return;
  }

  setTimeout(waitForGoogleDrive, 100);
}

waitForGoogleDrive();

/* Automatically restore only the local UI state; never trigger OAuth without
   a user gesture. */
setTimeout(() => {
  if (driveIsAuthorized()) {
    driveState.connected = true;
    setDriveStatus(true, "Connected");
  } else {
    const config = getSavedDriveConfig();
    setDriveStatus(
      false,
      config.clientId && !config.clientId.includes("PASTE_YOUR_")
        ? "Ready to connect"
        : "Client ID required"
    );
  }