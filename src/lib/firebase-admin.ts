import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';

let _db: Firestore | null = null;

export function getDb(): Firestore {
  if (_db) return _db;

  if (!getApps().length) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      'dave-487819';

    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (saJson) {
      try {
        const sa = JSON.parse(saJson);
        initializeApp({
          credential: cert({
            projectId: sa.project_id,
            clientEmail: sa.client_email,
            privateKey: sa.private_key?.replace(/\\n/g, '\n'),
          }),
          projectId: sa.project_id,
        });
      } catch (e) {
        initializeApp({ credential: applicationDefault(), projectId });
      }
    } else {
      initializeApp({ credential: applicationDefault(), projectId });
    }
  }

  _db = getFirestore();
  return _db;
}

export { Timestamp };
