import { getCachedToken } from "../services/googleDriveService";

export function getDriveAccessTokenOrThrow(): string {
  const token = getCachedToken();
  if (!token) {
    throw new Error("Please connect your Google Drive account first.");
  }
  return token;
}

export interface UploadPdfParams {
  token: string;
  blob: Blob;
  fileName: string;
  folderId?: string;
}

export async function uploadPdfBlobToDrive(params: UploadPdfParams) {
  const { token, blob, fileName, folderId } = params;

  const metadata = {
    name: fileName,
    mimeType: "application/pdf",
    ...(folderId ? { parents: [folderId] } : {}),
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append("file", blob);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size,mimeType",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      `Failed to upload to Google Drive: ${
        errorData?.error?.message || response.statusText
      }`
    );
  }

  return response.json();
}
