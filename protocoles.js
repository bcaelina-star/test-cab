import { neon } from '@neondatabase/serverless';

const ALLOWED = ['https://cabinet.psyh.fr'];
const ORDRE_MODULES = ['0','V','A','L','E','U','R'];

function cors(req,res){
  const o=req.headers.origin;
  if(ALLOWED.includes(o)) res.setHeader('Access-Control-Allow-Origin',o);
  else res.setHeader('Access-Control-Allow-Origin','https://cabinet.psyh.fr');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-cabinet-secret');
  res.setHeader('Vary','Origin');
}

export default async function handler(req,res){
  cors(req,res);
  if(req.method==='OPTIONS') return res.status(200).end();
  const secret=req.headers['x-cabinet-secret'];
  if(!secret||secret!==process.env.CABINET_SECRET) return res.status(401).json({error:'Unauthorized'});

  const sql=neon(process.env.DATABASE_URL);
  const{searchParams}=new URL(req.url,'https://x');
  const patient_id=searchParams.get('patient_id');

  // GET /api/protocoles?patient_id=X
  if(req.method==='GET'&&patient_id){
    const[proto]=await sql`SELECT * FROM protocoles WHERE patient_id=${patient_id}`;
    const seances=await sql`SELECT * FROM seances WHERE patient_id=${patient_id} ORDER BY date_seance DESC`;
    return res.status(200).json({protocole:proto||null,seances});
  }

  // POST — actions protocole
  if(req.method==='POST'){
    const{patient_id:pid,action,module_code,seance,notes_data}=req.body;
    if(!pid) return res.status(400).json({error:'patient_id requis'});

    // Valider un module → déverrouille le suivant
    if(action==='valider_module'&&module_code){
      const idx=ORDRE_MODULES.indexOf(module_code);
      const next=ORDRE_MODULES[Math.min(idx+1,ORDRE_MODULES.length-1)];
      await sql`UPDATE protocoles SET module_actif=${next},updated_at=NOW() WHERE patient_id=${pid}`;
      return res.status(200).json({success:true,module_suivant:next});
    }

    // Ajouter une séance
    if(action==='add_seance'&&seance){
      const{id,date_seance,duree_min,notes,module_code:mc}=seance;
      if(!id||!date_seance) return res.status(400).json({error:'id et date_seance requis'});
      await sql`
        INSERT INTO seances (id,patient_id,module_code,duree_min,notes,date_seance)
        VALUES (${id},${pid},${mc||'0'},${duree_min||60},${notes||null},${date_seance})
        ON CONFLICT (id) DO UPDATE SET notes=EXCLUDED.notes
      `;
      return res.status(200).json({success:true});
    }

    // Mettre à jour les notes d'étape (stockées dans modules_data JSONB)
    if(action==='update_notes'&&module_code&&notes_data!==undefined){
      await sql`
        UPDATE protocoles
        SET modules_data=COALESCE(modules_data,'{}'::jsonb) || ${JSON.stringify({[module_code]:notes_data})}::jsonb,
            updated_at=NOW()
        WHERE patient_id=${pid}
      `;
      return res.status(200).json({success:true});
    }

    // Forcer le module actif (correction manuelle)
    if(action==='set_module'&&module_code&&ORDRE_MODULES.includes(module_code)){
      await sql`UPDATE protocoles SET module_actif=${module_code},updated_at=NOW() WHERE patient_id=${pid}`;
      return res.status(200).json({success:true});
    }

    return res.status(400).json({error:'action non reconnue'});
  }

  return res.status(405).json({error:'Method not allowed'});
}
