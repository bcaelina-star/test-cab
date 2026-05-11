import { neon } from '@neondatabase/serverless';

const ALLOWED = ['https://cabinet.psyh.fr'];
const API_BASE = 'https://valeur-backend-api.vercel.app';

function cors(req,res){
  const o=req.headers.origin;
  if(ALLOWED.includes(o)) res.setHeader('Access-Control-Allow-Origin',o);
  else res.setHeader('Access-Control-Allow-Origin','https://cabinet.psyh.fr');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
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
  const urlParts=(req.url||'').split('?')[0].split('/').filter(Boolean);
  const bilanId=urlParts[urlParts.length-1]!=='bilans'?urlParts[urlParts.length-1]:null;

  // GET /api/bilans?patient_id=X
  if(req.method==='GET'&&patient_id){
    const rows=await sql`SELECT * FROM bilans WHERE patient_id=${patient_id} ORDER BY date_bilan DESC`;
    return res.status(200).json({bilans:rows});
  }

  // POST /api/bilans — créer ou mettre à jour
  if(req.method==='POST'){
    const{id,patient_id:pid,scores,date_bilan,source,notes}=req.body;
    if(!id||!pid||!scores||!date_bilan) return res.status(400).json({error:'id, patient_id, scores, date_bilan requis'});

    // Calcul profil via compute-profile (algorithme côté serveur)
    let spa=0,dominant='',profil_type='Résiduel',profil_masks=[''];
    try{
      const r=await fetch(`${API_BASE}/api/compute-profile`,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-cabinet-secret':process.env.CABINET_SECRET||''},
        body:JSON.stringify({scores})
      });
      if(r.ok){
        const d=await r.json();
        spa=d.spa; dominant=d.dominant; profil_type=d.profil_type; profil_masks=d.profil_masks;
      }
    }catch(e){ console.warn('compute-profile failed:',e.message); }

    await sql`
      INSERT INTO bilans (id,patient_id,scores,spa,dominant,profil_type,profil_masks,source,notes,date_bilan)
      VALUES (${id},${pid},${JSON.stringify(scores)},${spa},${dominant},${profil_type},
              ${JSON.stringify(profil_masks)},${source||'manuel'},${notes||null},${date_bilan})
      ON CONFLICT (id) DO UPDATE SET
        scores=EXCLUDED.scores,spa=EXCLUDED.spa,dominant=EXCLUDED.dominant,
        profil_type=EXCLUDED.profil_type,profil_masks=EXCLUDED.profil_masks,
        source=EXCLUDED.source,notes=EXCLUDED.notes,date_bilan=EXCLUDED.date_bilan
    `;

    // Créer protocole si inexistant
    const proto_id=pid+'-proto';
    await sql`
      INSERT INTO protocoles (id,patient_id,module_actif,modules_data)
      VALUES (${proto_id},${pid},'0','{}')
      ON CONFLICT (patient_id) DO NOTHING
    `;

    return res.status(200).json({success:true,id,spa,dominant,profil_type,profil_masks});
  }

  // DELETE /api/bilans/:id
  if(req.method==='DELETE'&&bilanId){
    await sql`DELETE FROM bilans WHERE id=${bilanId}`;
    return res.status(200).json({success:true});
  }

  return res.status(405).json({error:'Method not allowed'});
}
