import { supabase } from "./supabase";

export const PHONE_PHOTO_BUCKET = "phone-photos";

function safePhoneId(phoneId) {
  return String(phoneId ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function legacyDbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lager-iphone-media", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id" });
        store.createIndex("phoneId", "phoneId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function legacyPhotos(phoneId) {
  if (typeof indexedDB === "undefined") return [];
  const db = await legacyDbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readonly");
    const request = tx.objectStore("photos").index("phoneId").getAll(String(phoneId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function legacyPut(photo) {
  if (typeof indexedDB === "undefined") return;
  const db = await legacyDbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").put(photo);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function legacyDelete(id) {
  if (typeof indexedDB === "undefined") return;
  const db = await legacyDbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl || "").split(",");
  const mime = header?.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const binary = atob(encoded || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function cloudPhotos(phoneId) {
  const folder = safePhoneId(phoneId);
  const bucket = supabase.storage.from(PHONE_PHOTO_BUCKET);
  const { data, error } = await bucket.list(folder, {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error) throw error;

  const files = (data || []).filter((item) => item?.name && !item.name.endsWith("/"));
  if (!files.length) return [];

  const paths = files.map((item) => folder + "/" + item.name);
  const { data: signed, error: signedError } = await bucket.createSignedUrls(paths, 60 * 60 * 24 * 7);
  if (signedError) throw signedError;

  const byPath = new Map((signed || []).map((item) => [item.path, item.signedUrl]));
  return files.map((item) => {
    const storagePath = folder + "/" + item.name;
    return {
      id: storagePath,
      phoneId: String(phoneId),
      storagePath,
      dataUrl: byPath.get(storagePath) || "",
      createdAt: item.created_at || item.updated_at || "",
      cloud: true,
    };
  }).filter((photo) => photo.dataUrl);
}

async function uploadCloudPhoto(phoneId, dataUrl, preferredName = "") {
  const folder = safePhoneId(phoneId);
  const ext = String(dataUrl).startsWith("data:image/png") ? "png" : "jpg";
  const cleanName = preferredName
    ? String(preferredName).replace(/[^A-Za-z0-9._-]/g, "_")
    : Date.now() + "-" + Math.random().toString(36).slice(2, 9) + "." + ext;
  const path = folder + "/" + cleanName;
  const blob = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage.from(PHONE_PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function migrateLegacy(phoneId, existingCloud = []) {
  const legacy = await legacyPhotos(phoneId);
  if (!legacy.length) return existingCloud;

  const cloudNames = new Set(existingCloud.map((photo) => photo.storagePath?.split("/").pop()));
  let moved = false;
  for (const photo of legacy) {
    try {
      const preferred = "legacy-" + String(photo.id || Date.now()).replace(/[^A-Za-z0-9._-]/g, "_") + ".jpg";
      if (!cloudNames.has(preferred)) {
        await uploadCloudPhoto(phoneId, photo.dataUrl, preferred);
      }
      await legacyDelete(photo.id);
      moved = true;
    } catch {
      // Keep the legacy photo locally if cloud storage is not ready yet.
    }
  }
  return moved ? cloudPhotos(phoneId) : existingCloud;
}

export async function loadPhonePhotos(phoneId) {
  try {
    const cloud = await cloudPhotos(phoneId);
    const migrated = await migrateLegacy(phoneId, cloud);
    if (migrated.length) return migrated;
    const legacy = await legacyPhotos(phoneId);
    return legacy.map((photo) => ({ ...photo, cloud: false }));
  } catch {
    const legacy = await legacyPhotos(phoneId);
    return legacy.map((photo) => ({ ...photo, cloud: false }));
  }
}

export async function savePhonePhoto(phoneId, dataUrl) {
  try {
    await uploadCloudPhoto(phoneId, dataUrl);
    return { cloud: true };
  } catch (cloudError) {
    const photo = {
      id: "photo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      phoneId: String(phoneId),
      dataUrl,
      createdAt: new Date().toISOString(),
      cloud: false,
    };
    await legacyPut(photo);
    return { cloud: false, cloudError };
  }
}

export async function deletePhonePhoto(photo) {
  if (photo?.storagePath) {
    const { error } = await supabase.storage.from(PHONE_PHOTO_BUCKET).remove([photo.storagePath]);
    if (error) throw error;
    return;
  }
  if (photo?.id) await legacyDelete(photo.id);
}

export async function photoToFile(photo, index = 0) {
  const source = photo?.dataUrl || "";
  let blob;
  if (source.startsWith("data:")) {
    blob = dataUrlToBlob(source);
  } else {
    const response = await fetch(source);
    if (!response.ok) throw new Error("Could not prepare a phone photo for sharing.");
    blob = await response.blob();
  }
  const ext = blob.type === "image/png" ? "png" : "jpg";
  return new File([blob], "iphone-" + (index + 1) + "." + ext, {
    type: blob.type || "image/jpeg",
  });
}
