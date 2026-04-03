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

class FirebaseService {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private storage: FirebaseStorage | null = null;
  private auth: Auth | null = null;
  private initialized = false;

  initialize(config: FirebaseConfig): void {
    if (this.initialized) return;

    this.app = initializeApp(config);
    this.db = getFirestore(this.app);
    this.storage = getStorage(this.app);
    this.auth = getAuth(this.app);
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
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

    const allPatients = await this.getAllPatients();
    const term = searchTerm.toLowerCase();

    return allPatients.filter(p => 
      p.name.toLowerCase().includes(term) || 
      p.id.toLowerCase().includes(term)
    );
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
export default FirebaseService;