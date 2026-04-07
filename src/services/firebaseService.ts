import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  DocumentData,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { 
  getStorage, 
  FirebaseStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { 
  getAuth, 
  Auth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
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

class FirebaseService {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private storage: FirebaseStorage | null = null;
  private auth: Auth | null = null;
  private initialized = false;

  initialize(config?: FirebaseConfig): void {
    if (this.initialized) return;

    const firebaseConfig = config || getFirebaseConfigFromEnv();
    this.app = initializeApp(firebaseConfig);
    this.db = getFirestore(this.app);
    this.storage = getStorage(this.app);
    this.auth = getAuth(this.app);
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * @deprecated Use environment variables instead. This method exists for backwards compatibility.
   * Pass FirebaseConfig from a secure backend or environment variables.
   */
  initializeWithConfig(config: FirebaseConfig): void {
    this.initialize(config);
  }

  async signIn(email: string, password: string): Promise<User | null> {
    if (!this.auth) throw new Error('Firebase not initialized');
    
    const result = await signInWithEmailAndPassword(this.auth, email, password);
    return result.user;
  }

  async signUp(email: string, password: string): Promise<User | null> {
    if (!this.auth) throw new Error('Firebase not initialized');
    
    const result = await createUserWithEmailAndPassword(this.auth, email, password);
    return result.user;
  }

  async signOutUser(): Promise<void> {
    if (!this.auth) throw new Error('Firebase not initialized');
    await signOut(this.auth);
  }

  onAuthChange(callback: (user: User | null) => void): () => void {
    if (!this.auth) throw new Error('Firebase not initialized');
    return onAuthStateChanged(this.auth, callback);
  }

  async getCurrentUser(): Promise<User | null> {
    return this.auth?.currentUser || null;
  }

  async addPatient(patient: Omit<Patient, 'id'>): Promise<string> {
    if (!this.db) throw new Error('Firebase not initialized');

    const docRef = await addDoc(collection(this.db, 'patients'), {
      ...patient,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return docRef.id;
  }

  async getPatient(patientId: string): Promise<Patient | null> {
    if (!this.db) throw new Error('Firebase not initialized');

    const docSnap = await getDoc(doc(this.db, 'patients', patientId));
    
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as Patient;
    }
    return null;
  }

  async getAllPatients(): Promise<Patient[]> {
    if (!this.db) throw new Error('Firebase not initialized');

    const querySnapshot = await getDocs(
      query(collection(this.db, 'patients'), orderBy('updatedAt', 'desc'))
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({
      id: doc.id,
      ...doc.data()
    } as Patient));
  }

  async searchPatients(searchTerm: string): Promise<Patient[]> {
    if (!this.db) throw new Error('Firebase not initialized');

    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      return this.getAllPatients();
    }

    // Firestore doesn't support "contains" queries natively.
    // For production, consider using Algolia, Typesense, or Cloud Functions
    // with a search index. Here we use prefix-based pagination with orderBy.
    //
    // Option 1: Client-side filtering with limited fetch (current approach)
    // Option 2: Firestore prefix search using startAt/endAt on ordered fields
    // Option 3: Dedicated search service (Algolia, etc.)
    const searchResults: Patient[] = [];
    let hasMore = true;
    let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
    const maxResults = 50;
    const maxPages = 3;

    for (let page = 0; page < maxPages && hasMore; page++) {
      let queryBuilder = query(
        collection(this.db, 'patients'),
        orderBy('updatedAt', 'desc'),
        limit(30)
      );

      if (lastDoc) {
        queryBuilder = query(queryBuilder, startAfter(lastDoc));
      }

      const querySnapshot = await getDocs(queryBuilder);

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
    if (!this.db) throw new Error('Firebase not initialized');

    await updateDoc(doc(this.db, 'patients', patientId), {
      ...data,
      updatedAt: new Date().toISOString()
    });
  }

  async deletePatient(patientId: string): Promise<void> {
    if (!this.db) throw new Error('Firebase not initialized');

    const recordsQuery = query(
      collection(this.db, 'records'),
      where('patientId', '==', patientId)
    );
    const recordsSnapshot = await getDocs(recordsQuery);

    const deletePromises = recordsSnapshot.docs.map((recordDoc: QueryDocumentSnapshot<DocumentData>) => 
      deleteDoc(recordDoc.ref)
    );
    await Promise.all(deletePromises);

    await deleteDoc(doc(this.db, 'patients', patientId));
  }

  async addECGRecord(patientId: string, record: ECGRecord): Promise<string> {
    if (!this.db) throw new Error('Firebase not initialized');

    const docRef = await addDoc(collection(this.db, 'records'), {
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
    if (!this.db) throw new Error('Firebase not initialized');

    const querySnapshot = await getDocs(
      query(
        collection(this.db, 'records'),
        where('patientId', '==', patientId),
        orderBy('timestamp', 'desc')
      )
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({
      id: doc.id,
      ...doc.data()
    } as ECGRecord));
  }

  async getRecord(recordId: string): Promise<ECGRecord | null> {
    if (!this.db) throw new Error('Firebase not initialized');

    const docSnap = await getDoc(doc(this.db, 'records', recordId));
    
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as ECGRecord;
    }
    return null;
  }

  async updateRecordAnnotations(recordId: string, annotations: Annotation[]): Promise<void> {
    if (!this.db) throw new Error('Firebase not initialized');

    await updateDoc(doc(this.db, 'records', recordId), {
      annotations,
      updatedAt: new Date().toISOString()
    });
  }

  async updateRecordDiagnosis(
    recordId: string, 
    diagnosis: { label: string; confidence: number }
  ): Promise<void> {
    if (!this.db) throw new Error('Firebase not initialized');

    await updateDoc(doc(this.db, 'records', recordId), {
      diagnosis,
      updatedAt: new Date().toISOString()
    });
  }

  async deleteRecord(recordId: string): Promise<void> {
    if (!this.db) throw new Error('Firebase not initialized');

    await deleteDoc(doc(this.db, 'records', recordId));
  }

  async uploadFile(file: File, path: string): Promise<string> {
    if (!this.storage) throw new Error('Firebase not initialized');

    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.storage) throw new Error('Firebase not initialized');

    const storageRef = ref(this.storage, path);
    await deleteObject(storageRef);
  }

  async addTimelineEvent(event: Omit<TimelineEvent, 'id'>): Promise<string> {
    if (!this.db) throw new Error('Firebase not initialized');

    const docRef = await addDoc(collection(this.db, 'timeline'), {
      ...event,
      id: `evt_${Date.now()}`
    });

    return docRef.id;
  }

  async getPatientTimeline(patientId: string, limitCount: number = 20): Promise<TimelineEvent[]> {
    if (!this.db) throw new Error('Firebase not initialized');

    const querySnapshot = await getDocs(
      query(
        collection(this.db, 'timeline'),
        where('patientId', '==', patientId),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      )
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({
      id: doc.id,
      ...doc.data()
    } as TimelineEvent));
  }

  async getRecentRecords(limitCount: number = 10): Promise<ECGRecord[]> {
    if (!this.db) throw new Error('Firebase not initialized');

    const querySnapshot = await getDocs(
      query(
        collection(this.db, 'records'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      )
    );

    return querySnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({
      id: doc.id,
      ...doc.data()
    } as ECGRecord));
  }

  async searchByDiagnosis(diagnosis: string): Promise<ECGRecord[]> {
    const allRecords: ECGRecord[] = [];
    const querySnapshot = await getDocs(collection(this.db!, 'records'));
    
    querySnapshot.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
      const data = doc.data();
      if (data.diagnosis?.label === diagnosis) {
        allRecords.push({ id: doc.id, ...data } as ECGRecord);
      }
    });

    return allRecords;
  }
}

export const firebaseService = new FirebaseService();
export { FirebaseConfig };
export default FirebaseService;