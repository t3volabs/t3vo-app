import Dexie from "dexie";
import CryptoJS from "crypto-js";

// Define the IndexedDB database name.
const ENCRYPTION_KEY = sessionStorage.getItem("ENCRYPTION_KEY");

// Define the IndexedDB schema with a single table.
export const db = new Dexie("T3VO-Database");

db.version(1).stores({
  entries: "++id, type, data, updatedAt, deletedAt",
});

// Common constant for pagination.
const itemsPerPage = 10;

// Helper: Returns current timestamp.
const getCurrentTime = () => Date.now();

// Helper: Encrypts data using AES
export function encryptData(data) {
  if (!ENCRYPTION_KEY) return data;

  const stringData = typeof data === "object" ? JSON.stringify(data) : String(data);
  return CryptoJS.AES.encrypt(stringData, ENCRYPTION_KEY).toString();
}

// Helper: Decrypts data using AES
export function decryptData(encryptedData) {
  if (!ENCRYPTION_KEY || !encryptedData) return encryptedData;

  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

    // Try to parse as JSON, if it fails return as string
    try {
      return JSON.parse(decryptedString);
    } catch (e) {
      return decryptedString;
    }
  } catch (e) {
    console.error("Decryption failed:", e);
    return null;
  }
}

// Helper: Checks if any decrypted field contains the search query.
function matchesSearch(entry, searchQuery) {
  const lowerQuery = searchQuery.toLowerCase();
  const decryptedData = decryptData(entry.data);

  if (typeof decryptedData !== "object") {
    return String(decryptedData).toLowerCase().includes(lowerQuery);
  }

  return Object.values(decryptedData).some((value) => {
    return value && String(value).toLowerCase().includes(lowerQuery);
  });
}

// CRUD Functions

// Adds a new entry to the database.
export async function addEntry(type, data) {
  const entry = {
    type,
    data: encryptData(data),
    updatedAt: getCurrentTime(),
    deletedAt: null,
  };

  const id = await db.entries.add(entry);
  return id;
}

// Convenience functions for specific types
export async function addNoteEntry(noteData) {
  return addEntry("note", {
    title: noteData.title,
    content: noteData.content,
    tags: noteData.tags || [],
  });
}

export async function addBookmarkEntry(bookmarkData) {
  return addEntry("bookmark", {
    title: bookmarkData.title,
    url: bookmarkData.url,
    note: bookmarkData.note || "",
  });
}

export async function addPasswordEntry(passwordData) {
  return addEntry("password", {
    title: passwordData.title,
    username: passwordData.username,
    email: passwordData.email,
    password: passwordData.password,
    totpSecret: passwordData.totpSecret || "",
    urls: passwordData.urls || [],
  });
}

// Generic function for fetching entries with pagination and search.
async function fetchEntries(type, page = 1, searchQuery = "") {
  // Only include entries that haven't been soft-deleted.
  let query = db.entries
    .where("type")
    .equals(type)
    .and((entry) => entry.deletedAt === null)
    .reverse();

  let entries = await query.toArray();

  if (searchQuery) {
    entries = entries.filter((entry) => matchesSearch(entry, searchQuery));
  }

  // Sort by updatedAt (newest first)
  entries.sort((a, b) => b.updatedAt - a.updatedAt);

  // Apply pagination
  const offset = (page - 1) * itemsPerPage;
  const paginatedEntries = entries.slice(offset, offset + itemsPerPage);

  // Decrypt data for each entry
  return paginatedEntries.map((entry) => ({
    ...entry,
    data: decryptData(entry.data),
  }));
}

// Convenience functions for fetching specific types
export function fetchNotes(page = 1, searchQuery = "") {
  return fetchEntries("note", page, searchQuery);
}

export function fetchBookmarks(page = 1, searchQuery = "") {
  return fetchEntries("bookmark", page, searchQuery);
}

export function fetchPasswords(page = 1, searchQuery = "") {
  return fetchEntries("password", page, searchQuery);
}

// Soft deletes an entry by setting its deletedAt timestamp.
export async function softDeleteEntry(id) {
  const currentTime = getCurrentTime();
  await db.entries.update(id, {
    deletedAt: currentTime,
    updatedAt: currentTime,
  });
}

// Update an entry
export async function updateEntry(id, data) {
  const entry = await db.entries.get(id);
  if (!entry) throw new Error("Entry not found");

  await db.entries.update(id, {
    data: encryptData(data),
    updatedAt: getCurrentTime(),
  });
}

export async function updateNoteEntry(id, noteData) {
  const entry = await db.entries.get(id);
  if (!entry || entry.type !== "note") throw new Error("Note not found");

  const currentData = decryptData(entry.data);
  const updatedData = {
    ...currentData,
    title: noteData.title !== undefined ? noteData.title : currentData.title,
    content: noteData.content !== undefined ? noteData.content : currentData.content,
    tags: noteData.tags !== undefined ? noteData.tags : currentData.tags,
  };

  return updateEntry(id, updatedData);
}

export async function updateBookmarkEntry(id, bookmarkData) {
  const entry = await db.entries.get(id);
  if (!entry || entry.type !== "bookmark") throw new Error("Bookmark not found");

  const currentData = decryptData(entry.data);
  const updatedData = {
    ...currentData,
    title: bookmarkData.title !== undefined ? bookmarkData.title : currentData.title,
    url: bookmarkData.url !== undefined ? bookmarkData.url : currentData.url,
    note: bookmarkData.note !== undefined ? bookmarkData.note : currentData.note,
  };

  return updateEntry(id, updatedData);
}

export async function updatePasswordEntry(id, passwordData) {
  const entry = await db.entries.get(id);
  if (!entry || entry.type !== "password") throw new Error("Password not found");

  const currentData = decryptData(entry.data);
  const updatedData = {
    ...currentData,
    title: passwordData.title !== undefined ? passwordData.title : currentData.title,
    username: passwordData.username !== undefined ? passwordData.username : currentData.username,
    email: passwordData.email !== undefined ? passwordData.email : currentData.email,
    password: passwordData.password !== undefined ? passwordData.password : currentData.password,
    totpSecret: passwordData.totpSecret !== undefined ? passwordData.totpSecret : currentData.totpSecret,
    urls: passwordData.urls !== undefined ? passwordData.urls : currentData.urls,
  };

  return updateEntry(id, updatedData);
}

export async function getEntryById(id) {
  const entry = await db.entries.get(id);
  if (!entry || entry.deletedAt !== null) return null;

  return {
    ...entry,
    data: decryptData(entry.data),
  };
}

export async function getCounts() {
  const notes = await db.entries.where({ type: "note", deletedAt: null }).count();
  const bookmarks = await db.entries.where({ type: "bookmark", deletedAt: null }).count();
  const passwords = await db.entries.where({ type: "password", deletedAt: null }).count();

  return { notes, bookmarks, passwords };
}

// Export all entries (for backup purposes)
export async function exportAllEntries() {
  const entries = await db.entries.toArray();
  return entries;
}

// Import entries (for restore purposes)
export async function importEntries(entries) {
  await db.entries.clear();
  await db.entries.bulkAdd(entries);
}

// Periodically cleans up old entries that have been soft-deleted for more than 90 days.
if (Math.random() > 0.8) {
  console.log("Cleaning up old entries...");

  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  db.entries.where("deletedAt").below(ninetyDaysAgo).delete();
}
