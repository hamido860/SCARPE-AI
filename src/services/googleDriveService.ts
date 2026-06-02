import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Configure Google OAuth Provider
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive");

let isSigningIn = false;
let cachedAccessToken: string | null = typeof window !== "undefined" ? localStorage.getItem("scarpe_gdrive_access_token") : null;

// Initialize Auth listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (!cachedAccessToken && typeof window !== "undefined") {
        cachedAccessToken = localStorage.getItem("scarpe_gdrive_access_token");
      }
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // Fallback or request sign in if token is expired/not loaded
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (typeof window !== "undefined") {
        localStorage.removeItem("scarpe_gdrive_access_token");
      }
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google Popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to retrieve access token from Google sign-in.");
    }
    cachedAccessToken = credential.accessToken;
    if (typeof window !== "undefined") {
      localStorage.setItem("scarpe_gdrive_access_token", cachedAccessToken);
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: any) {
    console.error("[Google Auth Error]", err);
    throw err;
  } finally {
    isSigningIn = false;
  }
};

// Clear session / Sign out
export const googleSignOut = async (): Promise<void> => {
  try {
    await signOut(auth);
    cachedAccessToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("scarpe_gdrive_access_token");
    }
  } catch (err) {
    console.error("[Google Sign Out Error]", err);
    throw err;
  }
};

export const getCachedToken = (): string | null => {
  return cachedAccessToken;
};

// Direct client-side checks/uploads/queries to Google Drive
export const searchDriveFolder = async (accessToken: string, folderName: string, parentId?: string): Promise<string | null> => {
  try {
    let q = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    }
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      }
    });
    if (!res.ok) throw new Error(`Folder search failed: ${res.statusText}`);
    const data = await res.json();
    return data.files?.[0]?.id || null;
  } catch (err) {
    console.error("Error searching folder:", err);
    return null;
  }
};

export const createDriveFolder = async (accessToken: string, folderName: string, parentId?: string): Promise<string> => {
  try {
    const body: any = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) {
      body.parents = [parentId];
    }
    const res = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Folder creation failed: ${res.statusText}`);
    const data = await res.json();
    return data.id;
  } catch (err) {
    console.error("Error creating folder:", err);
    throw err;
  }
};

export const getOrCreateDriveFolder = async (accessToken: string, folderName: string, parentId?: string): Promise<string> => {
  const existingId = await searchDriveFolder(accessToken, folderName, parentId);
  if (existingId) return existingId;
  return await createDriveFolder(accessToken, folderName, parentId);
};
