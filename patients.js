import { neon } from '@neondatabase/serverless';

const ALLOWED = ['https://cabinet.psyh.fr'];
const PRAT_ID = 'celine';

function cors(req,res){
  const o=req.headers.origin;
  if(ALLOWED.includes(o)) res.setHeader('Access-Control-Allow-Origin',o);
  else res.setHeader('Access-Control-Allow-Origin','https://cabinet.psyh.fr');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-cabinet-secret');
  res.setHeader('Vary','Origin');
}

async function initTables(sql){
  await sql`CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    practitioner_id TEXT NOT NULL DEFAULT 'celine',
    prenom TEXT NOT NULL,
    nom TEXT NOT NULL,
    email TEXT,
    tel TEXT,
    dob DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_patients_prat ON patients(practitioner_id)`;
  await sql`CREATE TABLE IF NOT EXISTS bilans (
    id TEXT PRIMARY KEY,
    patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
    scores JSONB NOT NULL,
    spa INTEGER,
    dominant TEXT,
    profil_type TEXT,
    profil_masks JSONB,
    source TEXT DEFAULT 'manuel',
    notes TEXT,
    portrait_pdf TEXT,
    protocole JSONB,
    date_bilan DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS protocoles (
    id TEXT PRIMARY KEY,
    patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE UNIQUE,
    module_actif TEXT DEFAULT '0',
    modules_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS seances (
    id TEXT PRIMARY KEY,
    patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL DEFAULT '0',
    duree_min INTEGER DEFAULT 60,
    notes TEXT,
    date_seance DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
}

export default async function handler(req,res){
  cors(req,res);
  if(req.method==='OPTIONS') return res.status(200).end();
  const secret=req.headers['x-cabinet-secret'];
  if(!secret||secret!==process.env.CABINET_SECRET) return res.status(401).json({error:'Unauthorized'});

  const sql=neon(process.env.DATABASE_URL);
  await initTables(sql);

  const urlParts=(req.url||'').split('?')[0].split('/').filter(Boolean);
  const lastPart=urlParts[urlParts.length-1];
  const patientId=(lastPart&&lastPart!=='patients')?lastPart:null;

  // GET /api/patients — liste avec dernier bilan
  if(req.method==='GET'&&!patientId){
    const rows=await sql`
      SELECT p.id,p.prenom,p.nom,p.email,p.tel,p.dob,p.notes,p.created_at,p.updated_at,
        b.scores,b.spa,b.dominant,b.profil_type,b.profil_masks,b.date_bilan,
        pr.module_actif
      FROM patients p
      LEFT JOIN LATERAL (
        SELECT * FROM bilans WHERE patient_id=p.id ORDER BY date_bilan DESC LIMIT 1
      ) b ON true
      LEFT JOIN protocoles pr ON pr.patient_id=p.id
      WHERE p.practitioner_id=${PRAT_ID}
      ORDER BY p.updated_at DESC
    `;
    return res.status(200).json({patients:rows});
  }

  // GET /api/patients/:id — fiche complète
  if(req.method==='GET'&&patientId){
    const[p]=await sql`SELECT * FROM patients WHERE id=${patientId} AND practitioner_id=${PRAT_ID}`;
    if(!p) return res.status(404).json({error:'Patient non trouvé'});
    const bilans=await sql`SELECT * FROM bilans WHERE patient_id=${patientId} ORDER BY date_bilan DESC`;
    const[proto]=await sql`SELECT * FROM protocoles WHERE patient_id=${patientId}`;
    const seances=await sql`SELECT * FROM seances WHERE patient_id=${patientId} ORDER BY date_seance DESC`;
    return res.status(200).json({...p,bilans,protocole:proto||null,seances});
  }

  // POST /api/patients — créer ou mettre à jour
  if(req.method==='POST'){
    const{id,prenom,nom,email,tel,dob,notes}=req.body;
    if(!id||!prenom||!nom) return res.status(400).json({error:'id, prenom, nom requis'});
    await sql`
      INSERT INTO patients (id,practitioner_id,prenom,nom,email,tel,dob,notes,updated_at)
      VALUES (${id},${PRAT_ID},${prenom},${nom},${email||null},${tel||null},${dob||null},${notes||null},NOW())
      ON CONFLICT (id) DO UPDATE SET
        prenom=EXCLUDED.prenom,nom=EXCLUDED.nom,email=EXCLUDED.email,
        tel=EXCLUDED.tel,dob=EXCLUDED.dob,notes=EXCLUDED.notes,updated_at=NOW()
    `;
    return res.status(200).json({success:true,id});
  }

  // DELETE /api/patients/:id
  if(req.method==='DELETE'&&patientId){
    await sql`DELETE FROM patients WHERE id=${patientId} AND practitioner_id=${PRAT_ID}`;
    return res.status(200).json({success:true});
  }

  return res.status(405).json({error:'Method not allowed'});
}
