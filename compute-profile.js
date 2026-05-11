// /api/compute-profile.js — Algorithme V.A.L.E.U.R© côté serveur
// © Céline Bourbon — Confidentiel — Ne pas reproduire

const ALLOWED = ['https://cabinet.psyh.fr','https://questionnaire.psyh.fr','https://valeur.psyh.fr'];
const MASKS   = ['rouge','orange','jaune','vert','bleu','indigo','violet'];
const TIEBREAK = ['jaune','rouge','indigo','vert','bleu','orange','violet'];
const LEVELS  = [
  {label:'Non significatif',min:0, max:29},
  {label:'Modéré',          min:30,max:49},
  {label:'Significatif',    min:50,max:64},
  {label:'Élevé',           min:65,max:79},
  {label:'Dominant',        min:80,max:100},
];

function getLevel(p){ return LEVELS.find(l=>p>=l.min&&p<=l.max)?.label||'Non significatif'; }

function tbSort(a,b,s){
  const d=(s[b]||0)-(s[a]||0);
  if(Math.abs(d)>0.5) return d;
  return TIEBREAK.indexOf(a)-TIEBREAK.indexOf(b);
}

function computeProfile(s){
  const sorted=MASKS.slice().sort((a,b)=>tbSort(a,b,s));
  const v=m=>s[m]||0;
  const [m0,m1,m2]=sorted;
  const s0=v(m0),s1=v(m1),s2=v(m2),s5=v(sorted[5]);
  const ab65=sorted.filter(m=>v(m)>=65);
  if(ab65.length>=6&&(s0-s5)<=20){
    const e=s0-s5;
    const sub=ab65.length===7&&e<=10?'Équilibré':e<=10?'Vigilant léger':e<=15?'Vigilant modéré':'Zone de transition';
    return{type:'Pan-masques',subType:sub,masks:ab65};
  }
  if(s0>=80) return{type:'Mono dominant',masks:[m0]};
  if(s2>=60&&(s0-s2)<=15) return{type:'Triade',masks:sorted.slice(0,3)};
  if(s1>=65&&(s0-s1)<=10) return{type:'Dyade',masks:sorted.slice(0,2)};
  return{type:'Résiduel',masks:[m0]};
}

function computeSPA(s){
  return Math.round(100-MASKS.reduce((t,m)=>t+(s[m]||0),0)/MASKS.length);
}

export default function handler(req,res){
  const origin=req.headers.origin;
  if(ALLOWED.includes(origin)) res.setHeader('Access-Control-Allow-Origin',origin);
  else res.setHeader('Access-Control-Allow-Origin','https://cabinet.psyh.fr');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-cabinet-secret');
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const secret=req.headers['x-cabinet-secret'];
  if(!secret||secret!==process.env.CABINET_SECRET) return res.status(401).json({error:'Unauthorized'});

  const{scores}=req.body;
  if(!scores||typeof scores!=='object') return res.status(400).json({error:'scores requis'});

  const sc={};
  MASKS.forEach(m=>{const r=parseFloat(scores[m])||0; sc[m]=r>1?Math.round(r):Math.round(r*100);});

  const spa=computeSPA(sc);
  const profil=computeProfile(sc);

  return res.status(200).json({
    scores:sc, spa,
    dominant:profil.masks[0],
    profil_type:profil.type,
    profil_masks:profil.masks,
    profil_sub:profil.subType||null,
    levels:Object.fromEntries(MASKS.map(m=>[m,getLevel(sc[m]||0)])),
  });
}
