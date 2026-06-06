// Firebase SDK is heavy (~1.1 MiB combined) and only used in the
// AnnotationStudio workflow. We pull it in lazily via dynamic import so
// the Firebase chunk is split out of the main entrypoint. The type-only
// imports below keep TypeScript happy without dragging the runtime in,
// and the concrete helper functions live on instance fields that
// `initialize()` populates on first call.
import type { FirebaseApp } from 'firebase/app';
import type { Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { Auth, User } from 'firebase/auth';
import { Patient, ECGRecord, Annotation, TimelineEvent } from '../types';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function getFirebaseConfigFromEnv(): FirebaseConfig {
  const config: FirebaseConfig = {
    apiKey: import.meta.env.REACT_APP_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.REACT_APP_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.REACT_APP_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.REACT_APP_FIREBASE_APP_ID || '',
  };

  if (!config.apiKey || !config.projectId) {
    console.warn(
      '[FirebaseService] Firebase config is incomplete. ' +
      'Please set REACT_APP_FIREBASE_* environment variables in your .env file.'
    );
  }

  return config;
}

// Shape of the helper objects we cache from each dynamic import. Using
// `unknown` for values keeps the surface type-safe enough for the methods
// below while avoiding `any`; methods that consume these fields are
// already covered by Firebase's own type definitions once we have the
// runtime references in place.
type FirestoreHelpers = {
  collection: typeof import('firebase/firestore').collection;
  doc: typeof import('firebase/firestore').doc;
  getDoc: typeof import('firebase/firestore').getDoc;
  getDocs: typeof import('firebase/firestore').getDocs;
  addDoc: typeof import('firebase/firestore').addDoc;
  updateDoc: typeof import('firebase/firestore').updateDoc;
  deleteDoc: typeof import('firebase/firestore').deleteDoc;
  query: typeof import('firebase/firestore').query;
  where: typeof import('firebase/firestore').where;
  orderBy: typeof import('firebase/firestore').orderBy;
  limit: typeof import('firebase/firestore').limit;
  startAfter: typeof import('firebase/firestore').startAfter;
};

type StorageHelpers = {
  ref: typeof import('firebase/storage').ref;
  uploadBytes: typeof import('firebase/storage').uploadBytes;
  getDownloadURL: typeof import('firebase/storage').getDownloadURL;
  deleteObject: typeof import('firebase/storage').deleteObject;
};

type AuthHelpers = {
  signInWithEmailAndPassword: typeof import('firebase/auth').signInWithEmailAndPassword;
  createUserWithEmailAndPassword: typeof import('firebase/auth').createUserWithEmailAndPassword;
  signOut: typeof import('firebase/auth').signOut;
  onAuthStateChanged: typeof import('firebase/auth').onAuthStateChanged;
};

class FirebaseService {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private storage: FirebaseStorage | null = null;
  private auth: Auth | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private fs: FirestoreHelpers | null = null;
  private st: StorageHelpers | null = null;
  private au: AuthHelpers | null = null;

  /**
   * Lazily load the Firebase SDK and initialize the app + Firestore +
   * Storage + Auth handles. Idempotent: calling it again after a
   * successful init is a no-op. Concurrent callers share the same
   * in-flight promise, so the SDK is fetched once even if `initialize`
   * is called from multiple components at once.
   *
   * Each Firebase sub-package is imported on demand and not at the
   * top of this file, which keeps `firebase/app` + `firebase/firestore` +
   * `firebase/storage` + `firebase/auth` (~1.1 MiB combined) out of the
   * main entrypoint. Webpack's `firebase` cacheGroup is also set to
   * `chunks: 'async'` so these end up in a separate async chunk that
   * AnnotationStudio pulls only when the user actually opens the workbench.
   */
  initialize(config?: FirebaseConfig): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const [
        { initializeApp },
        firestoreMod,
        storageMod,
        authMod,
      ] = await Promise.all([
        import(/* webpackChunkName: "firebase" */ 'firebase/app'),
        import(/* webpackChunkName: "firebase" */ 'firebase/firestore'),
        import(/* webpackChunkName: "firebase" */ 'firebase/storage'),
        import(/* webpackChunkName: "firebase" */ 'firebase/auth'),
      ]);

      this.fs = {
        collection: firestoreMod.collection,
        doc: firestoreMod.doc,
        getDoc: firestoreMod.getDoc,
        getDocs: firestoreMod.getDocs,
        addDoc: firestoreMod.addDoc,
        updateDoc: firestoreMod.updateDoc,
        deleteDoc: firestoreMod.deleteDoc,
        query: firestoreMod.query,
        where: firestoreMod.where,
        orderBy: firestoreMod.orderBy,
        limit: firestoreMod.limit,
        startAfter: firestoreMod.startAfter,
      };
      this.st = {
        ref: storageMod.ref,
        uploadBytes: storageMod.uploadBytes,
        getDownloadURL: storageMod.getDownloadURL,
        deleteObject: storageMod.deleteObject,
      };
      this.au = {
        signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
        createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
        signOut: authMod.signOut,
        onAuthStateChanged: authMod.onAuthStateChanged,
      };

      const firebaseConfig = config || getFirebaseConfigFromEnv();
      this.app = initializeApp(firebaseConfig);
      this.db = firestoreMod.getFirestore(this.app);
      this.storage = storageMod.getStorage(this.app);
      this.auth = authMod.getAuth(this.app);
      this.initialized = true;
    })();

    return this.initPromise;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * @deprecated Use environment variables instead. This method exists for backwards compatibility.
   * Pass FirebaseConfig from a secure backend or environment variables.
   */
  initializeWithConfig(config: FirebaseConfig): Promise<void> {
    return this.initialize(config);
  }

  async signIn(email: string, password: string): Promise<User | null> {
    if (!this.auth || !this.au) throw new Error('Firebase not initialized');

    const result = await this.au.signInWithEmailAndPassword(this.auth, email, password);
    return result.user;
  }

  async signUp(email: string, password: string): Promise<User | null> {
    if (!this.auth || !this.au) throw new Error('Firebase not initialized');

    const result = await this.au.createUserWithEmailAndPassword(this.auth, email, password);
    return result.user;
  }

  async signOutUser(): Promise<void> {
    if (!this.auth || !this.au) throw new Error('Firebase not initialized');
    await this.au.signOut(this.auth);
  }

  onAuthChange(callback: (user: User | null) => void): () => void {
    if (!this.auth || !this.au) throw new Error('Firebase not initialized');
    return this.au.onAuthStateChanged(this.auth, callback);
  }

  async getCurrentUser(): Promise<User | null> {
    return this.auth?.currentUser || null;
  }

  async addPatient(patient: Omit<Patient, 'id'>): Promise<string> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const docRef = await this.fs.addDoc(this.fs.collection(this.db, 'patients'), {
      ...patient,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return docRef.id;
  }

  async getPatient(patientId: string): Promise<Patient | null> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const docSnap = await this.fs.getDoc(this.fs.doc(this.db, 'patients', patientId));

    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as Patient;
    }
    return null;
  }

  async getAllPatients(): Promise<Patient[]> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const querySnapshot = await this.fs.getDocs(
      this.fs.query(this.fs.collection(this.db, 'patients'), this.fs.orderBy('updatedAt', 'desc'))
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Patient));
  }

  async searchPatients(searchTerm: string): Promise<Patient[]> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      return this.getAllPatients();
    }

    // Firestore doesn't support "contains" queries natively.
    // For production, consider using Algolia, Typesense, or Cloud Functions
    // with a search index. Here we use prefix-based pagination with orderBy.
    const searchResults: Patient[] = [];
    let hasMore = true;
    let lastDoc: QueryDocumentSnapshot | null = null;
    const maxResults = 50;
    const maxPages = 3;

    for (let page = 0; page < maxPages && hasMore; page++) {
      let queryBuilder = this.fs.query(
        this.fs.collection(this.db, 'patients'),
        this.fs.orderBy('updatedAt', 'desc'),
        this.fs.limit(30)
      );

      if (lastDoc) {
        queryBuilder = this.fs.query(queryBuilder, this.fs.startAfter(lastDoc));
      }

      const querySnapshot = await this.fs.getDocs(queryBuilder);

      if (querySnapshot.empty) {
        break;
      }

      for (const doc of querySnapshot.docs) {
        const patient = { id: doc.id, ...doc.data() } as Patient;
        if (
          patient.name?.toLowerCase().includes(term) ||
          patient.id?.toLowerCase().includes(term)
        ) {
          searchResults.push(patient);
        }
        lastDoc = doc;
      }

      hasMore = querySnapshot.docs.length === 30 && searchResults.length < maxResults;
    }

    return searchResults.slice(0, maxResults);
  }

  async updatePatient(patientId: string, data: Partial<Patient>): Promise<void> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    await this.fs.updateDoc(this.fs.doc(this.db, 'patients', patientId), {
      ...data,
      updatedAt: new Date().toISOString()
    });
  }

  async deletePatient(patientId: string): Promise<void> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const recordsQuery = this.fs.query(
      this.fs.collection(this.db, 'records'),
      this.fs.where('patientId', '==', patientId)
    );
    const recordsSnapshot = await this.fs.getDocs(recordsQuery);

    const deletePromises = recordsSnapshot.docs.map((recordDoc: QueryDocumentSnapshot) =>
      this.fs!.deleteDoc(recordDoc.ref)
    );
    await Promise.all(deletePromises);

    await this.fs.deleteDoc(this.fs.doc(this.db, 'patients', patientId));
  }

  async addECGRecord(patientId: string, record: ECGRecord): Promise<string> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const docRef = await this.fs.addDoc(this.fs.collection(this.db, 'records'), {
      ...record,
      patientId,
      createdAt: new Date().toISOString()
    });

    await this.addTimelineEvent({
      patientId,
      recordId: docRef.id,
      type: 'create',
      description: 'Added new ECG record',
      timestamp: new Date().toISOString()
    });

    return docRef.id;
  }

  async getPatientRecords(patientId: string): Promise<ECGRecord[]> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const querySnapshot = await this.fs.getDocs(
      this.fs.query(
        this.fs.collection(this.db, 'records'),
        this.fs.where('patientId', '==', patientId),
        this.fs.orderBy('timestamp', 'desc')
      )
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as ECGRecord));
  }

  async getRecord(recordId: string): Promise<ECGRecord | null> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const docSnap = await this.fs.getDoc(this.fs.doc(this.db, 'records', recordId));

    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as ECGRecord;
    }
    return null;
  }

  async updateRecordAnnotations(recordId: string, annotations: Annotation[]): Promise<void> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    await this.fs.updateDoc(this.fs.doc(this.db, 'records', recordId), {
      annotations,
      updatedAt: new Date().toISOString()
    });
  }

  async updateRecordDiagnosis(
    recordId: string,
    diagnosis: { label: string; confidence: number }
  ): Promise<void> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    await this.fs.updateDoc(this.fs.doc(this.db, 'records', recordId), {
      diagnosis,
      updatedAt: new Date().toISOString()
    });
  }

  async deleteRecord(recordId: string): Promise<void> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    await this.fs.deleteDoc(this.fs.doc(this.db, 'records', recordId));
  }

  async uploadFile(file: File, path: string): Promise<string> {
    if (!this.storage || !this.st) throw new Error('Firebase not initialized');

    const storageRef = this.st.ref(this.storage, path);
    await this.st.uploadBytes(storageRef, file);
    return await this.st.getDownloadURL(storageRef);
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.storage || !this.st) throw new Error('Firebase not initialized');

    const storageRef = this.st.ref(this.storage, path);
    await this.st.deleteObject(storageRef);
  }

  async addTimelineEvent(event: Omit<TimelineEvent, 'id'>): Promise<string> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const docRef = await this.fs.addDoc(this.fs.collection(this.db, 'timeline'), {
      ...event,
      id: `evt_${Date.now()}`
    });

    return docRef.id;
  }

  async getPatientTimeline(patientId: string, limitCount: number = 20): Promise<TimelineEvent[]> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const querySnapshot = await this.fs.getDocs(
      this.fs.query(
        this.fs.collection(this.db, 'timeline'),
        this.fs.where('patientId', '==', patientId),
        this.fs.orderBy('timestamp', 'desc'),
        this.fs.limit(limitCount)
      )
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as TimelineEvent));
  }

  async getRecentRecords(limitCount: number = 10): Promise<ECGRecord[]> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const querySnapshot = await this.fs.getDocs(
      this.fs.query(
        this.fs.collection(this.db, 'records'),
        this.fs.orderBy('timestamp', 'desc'),
        this.fs.limit(limitCount)
      )
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as ECGRecord));
  }

  async searchByDiagnosis(diagnosis: string): Promise<ECGRecord[]> {
    if (!this.db || !this.fs) throw new Error('Firebase not initialized');

    const allRecords: ECGRecord[] = [];
    const querySnapshot = await this.fs.getDocs(this.fs.collection(this.db, 'records'));

    querySnapshot.forEach((doc: QueryDocumentSnapshot) => {
      const data = doc.data();
      if (data.diagnosis?.label === diagnosis) {
        allRecords.push({ id: doc.id, ...data } as ECGRecord);
      }
    });

    return allRecords;
  }
}

export const firebaseService = new FirebaseService();
export default FirebaseService;
