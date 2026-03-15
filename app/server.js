require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');
const sms     = require('./sms');
let pdf = null;
try { pdf = require('./pdf'); console.log('✅ PDF module loaded'); }
catch(e) { console.log('⚠️ PDF not available. Run: npm install pdfkit'); }
const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ebloodbank_secret_key';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

let db = null;
async function connectDB() {
  try {
    db = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'ebloodbank',
      waitForConnections: true,
      connectionLimit: 10,
    });
    const conn = await db.getConnection();
    console.log('✅ MySQL connected successfully');
    conn.release();
  } catch (err) {
    console.log('⚠️  MySQL not connected — running in DEMO MODE');
    db = null;
  }
}
connectDB();

const compatibilityMap = {
  'A+':  { canDonate: ['A+','AB+'],                             canReceive: ['A+','A-','O+','O-'] },
  'A-':  { canDonate: ['A+','A-','AB+','AB-'],                  canReceive: ['A-','O-'] },
  'B+':  { canDonate: ['B+','AB+'],                             canReceive: ['B+','B-','O+','O-'] },
  'B-':  { canDonate: ['B+','B-','AB+','AB-'],                  canReceive: ['B-','O-'] },
  'AB+': { canDonate: ['AB+'],                                  canReceive: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },
  'AB-': { canDonate: ['AB+','AB-'],                            canReceive: ['A-','B-','AB-','O-'] },
  'O+':  { canDonate: ['A+','B+','O+','AB+'],                   canReceive: ['O+','O-'] },
  'O-':  { canDonate: ['A+','A-','B+','B-','O+','O-','AB+','AB-'], canReceive: ['O-'] }
};

const demoDonors = [
  { id:1, first_name:'Rahul',  last_name:'Sharma',  blood_group:'O+', city:'Hyderabad', phone:'9876543210', is_available:1, donation_count:5 },
  { id:2, first_name:'Priya',  last_name:'Reddy',   blood_group:'A+', city:'Hyderabad', phone:'9876543211', is_available:1, donation_count:3 },
  { id:3, first_name:'Vikram', last_name:'Singh',   blood_group:'B+', city:'Hyderabad', phone:'9876543215', is_available:1, donation_count:7 },
  { id:4, first_name:'Sneha',  last_name:'Patel',   blood_group:'O-', city:'Hyderabad', phone:'9876543216', is_available:1, donation_count:2 },
  { id:5, first_name:'Arjun',  last_name:'Nair',    blood_group:'AB+',city:'Mumbai',    phone:'9876543217', is_available:1, donation_count:4 },
];

function auth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token. Please login first.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ message: 'Token expired. Please login again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ message: 'Access denied. Required: ' + roles.join(' or ') });
    next();
  };
}
// GET /api/certificate
app.get('/api/certificate', async (req, res) => {
  if (!pdf) {
    return res.status(503).json({ 
      message: 'PDF not installed. Run: npm install pdfkit' 
    });
  }
  const { donorName, bloodGroup, donationDate, hospitalName, units } = req.query;
  if (!donorName || !bloodGroup) {
    return res.status(400).json({ message: 'donorName and bloodGroup required.' });
  }
  try {
    const pdfBuffer = await pdf.generateCertificate({
      donorName,
      bloodGroup,
      donationDate: donationDate || new Date().toLocaleDateString('en-IN'),
      hospitalName: hospitalName || 'eBloodBank',
      units: units || 1
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 
      'attachment; filename="' + donorName.replace(/ /g,'_') + '_Certificate.pdf"'
    );
    res.send(pdfBuffer);
  } catch(e) {
    res.status(500).json({ message: 'PDF failed: ' + e.message });
  }
});
// GET /api/test
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'eBloodBank API is running!',
    db: db ? 'connected' : 'demo mode',
    time: new Date().toISOString(),
    apis: [
      'POST /api/register',
      'POST /api/login',
      'GET  /api/donors',
      'GET  /api/search',
      'GET  /api/voice/search',
      'GET  /api/compatibility/:bloodGroup',
      'GET  /api/stats',
      'GET  /api/alerts',
      'POST /api/alerts',
      'GET  /api/requests',
      'POST /api/request',
      'GET  /api/donor/dashboard',
      'PUT  /api/donor/availability',
      'POST /api/donation/record',
      'GET  /api/receiver/dashboard',
      'GET  /api/hospital/dashboard',
      'PUT  /api/hospital/stock',
      'GET  /api/reminders'
    ]
  });
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  if (db) {
    try {
      const [[d]] = await db.execute("SELECT COUNT(*) as c FROM users WHERE role='donor' AND is_active=1");
      const [[h]] = await db.execute("SELECT COUNT(*) as c FROM hospitals");
      const [[t]] = await db.execute("SELECT COALESCE(SUM(donation_count),0) as t FROM donors");
      return res.json({ totalDonors:d.c, totalHospitals:h.c, totalDonations:t.t, livesSaved:t.t*3 });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ totalDonors:12800, totalHospitals:340, totalDonations:4280, livesSaved:12840 });
});

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { role, firstName, lastName, email, phone, dob, bloodGroup, city, password, hospitalName, license, lastDonation } = req.body;
  if (!role||!firstName||!lastName||!email||!password)
    return res.status(400).json({ message: 'All required fields must be filled.' });
  if (!['donor','receiver','hospital'].includes(role))
    return res.status(400).json({ message: 'Invalid role.' });
  if (password.length < 8)
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });

  const hashed = await bcrypt.hash(password, 12);

  if (db) {
    try {
      const [ex] = await db.execute('SELECT id FROM users WHERE email=?', [email]);
      if (ex.length) return res.status(409).json({ message: 'Email already registered. Please login.' });
      const [r] = await db.execute(
        'INSERT INTO users (role,first_name,last_name,email,phone,dob,blood_group,city,password_hash,is_active) VALUES (?,?,?,?,?,?,?,?,?,1)',
        [role,firstName,lastName,email,phone||null,dob||null,bloodGroup||null,city||null,hashed]
      );
      const uid = r.insertId;
      if (role==='donor')
        await db.execute('INSERT INTO donors (user_id,last_donation_date,donation_count,is_available) VALUES (?,?,0,1)',[uid,lastDonation||null]);
      else if (role==='hospital')
        await db.execute('INSERT INTO hospitals (user_id,hospital_name,license_number,blood_stock_json) VALUES (?,?,?,?)',[uid,hospitalName||'',license||'','{"A+":0,"A-":0,"B+":0,"B-":0,"AB+":0,"AB-":0,"O+":0,"O-":0}']);
      const token = jwt.sign({id:uid,email,role},JWT_SECRET,{expiresIn:'7d'});
      return res.status(201).json({ message:'Account created successfully!', token, role, user:{id:uid,firstName,lastName,email,bloodGroup,city,role} });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  const token = jwt.sign({id:999,email,role},JWT_SECRET,{expiresIn:'7d'});
  res.status(201).json({ message:'Account created! (Demo mode)', token, role, user:{id:999,firstName,lastName,email,bloodGroup,city,role} });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email||!password||!role) return res.status(400).json({ message: 'Email, password and role required.' });
  if (db) {
    try {
      const [rows] = await db.execute('SELECT * FROM users WHERE email=? AND role=? AND is_active=1',[email,role]);
      if (!rows.length) return res.status(401).json({ message: 'No account found with this email and role.' });
      const u = rows[0];
      if (!await bcrypt.compare(password,u.password_hash)) return res.status(401).json({ message: 'Incorrect password.' });
      await db.execute('UPDATE users SET last_login=NOW() WHERE id=?',[u.id]);
      const token = jwt.sign({id:u.id,email:u.email,role:u.role},JWT_SECRET,{expiresIn:'7d'});
      return res.json({ message:'Login successful!', token, role:u.role, user:{id:u.id,firstName:u.first_name,lastName:u.last_name,email:u.email,bloodGroup:u.blood_group,city:u.city,role:u.role} });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  const demos = { donor:{id:1,firstName:'Rahul',lastName:'Sharma',bloodGroup:'O+',city:'Hyderabad'}, receiver:{id:2,firstName:'Aman',lastName:'Verma',bloodGroup:'B+',city:'Hyderabad'}, hospital:{id:3,firstName:'Apollo',lastName:'Admin',bloodGroup:null,city:'Hyderabad'} };
  const demo = demos[role] || demos.donor;
  const token = jwt.sign({id:demo.id,email,role},JWT_SECRET,{expiresIn:'7d'});
  res.json({ message:'Login successful! (Demo mode)', token, role, user:{...demo,email,role} });
});

// GET /api/donors
app.get('/api/donors', auth, async (req, res) => {
  const { bloodGroup, city, available } = req.query;
  if (db) {
    try {
      let sql = "SELECT u.id,u.first_name,u.last_name,u.blood_group,u.city,u.phone,d.last_donation_date,d.donation_count,d.is_available FROM users u JOIN donors d ON u.id=d.user_id WHERE u.role='donor' AND u.is_active=1";
      const p = [];
      if (bloodGroup) { sql+=' AND u.blood_group=?'; p.push(bloodGroup); }
      if (city)       { sql+=' AND u.city LIKE ?';   p.push('%'+city+'%'); }
      if (available!==undefined) { sql+=' AND d.is_available=?'; p.push(Number(available)); }
      sql+=' ORDER BY d.is_available DESC,d.last_donation_date ASC';
      const [donors] = await db.execute(sql,p);
      return res.json({ count:donors.length, donors });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  let f = [...demoDonors];
  if (bloodGroup) f=f.filter(d=>d.blood_group===bloodGroup);
  if (city) f=f.filter(d=>d.city.toLowerCase().includes(city.toLowerCase()));
  res.json({ count:f.length, donors:f });
});

// GET /api/search
app.get('/api/search', async (req, res) => {
  const { bloodGroup, city } = req.query;
  if (!bloodGroup) return res.status(400).json({ message: 'bloodGroup required. Example: /api/search?bloodGroup=O%2B' });
  const compatible = compatibilityMap[bloodGroup]?.canReceive || [bloodGroup];
  if (db) {
    try {
      let sql = 'SELECT u.id,u.first_name,u.last_name,u.blood_group,u.city,d.last_donation_date,d.is_available FROM users u JOIN donors d ON u.id=d.user_id WHERE u.role=\'donor\' AND u.is_active=1 AND d.is_available=1 AND u.blood_group IN ('+compatible.map(()=>'?').join(',')+')';
      const p = [...compatible];
      if (city) { sql+=' AND u.city LIKE ?'; p.push('%'+city+'%'); }
      sql+=' LIMIT 50';
      const [donors] = await db.execute(sql,p);
      return res.json({ requested:bloodGroup, compatibleGroups:compatible, count:donors.length, donors });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  const f = demoDonors.filter(d=>compatible.includes(d.blood_group)&&d.is_available===1&&(!city||d.city.toLowerCase().includes(city.toLowerCase())));
  res.json({ requested:bloodGroup, compatibleGroups:compatible, count:f.length, donors:f });
});

// GET /api/voice/search
app.get('/api/voice/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ message: 'q parameter required. Example: /api/voice/search?q=I need O positive blood in Hyderabad' });
  const bgMap = [
    [/AB\+|AB\s*positive/i,'AB+'],[/AB\-|AB\s*negative/i,'AB-'],
    [/\bA\+|\bA\s*positive/i,'A+'],[/\bA\-|\bA\s*negative/i,'A-'],
    [/\bB\+|\bB\s*positive/i,'B+'],[/\bB\-|\bB\s*negative/i,'B-'],
    [/\bO\+|\bO\s*positive/i,'O+'],[/\bO\-|\bO\s*negative/i,'O-'],
  ];
  let bloodGroup = null;
  for (const [pat,bg] of bgMap) { if (pat.test(q)) { bloodGroup=bg; break; } }
  const cities = ['Hyderabad','Mumbai','Delhi','Chennai','Bangalore','Pune','Kolkata','Ahmedabad','Jaipur','Surat','Lucknow'];
  let city = null;
  for (const c of cities) { if (q.toLowerCase().includes(c.toLowerCase())) { city=c; break; } }
  const urgent = /urgent|emergency|critical|asap|now/i.test(q);
  if (!bloodGroup) return res.json({ parsed:{query:q,bloodGroup:null,city,urgent}, message:'Could not detect blood group. Try: "I need O positive blood in Hyderabad"', suggestions:['O positive','A negative','B positive','AB negative'] });
  const compatible = compatibilityMap[bloodGroup]?.canReceive || [bloodGroup];
  if (db) {
    try {
      let sql = 'SELECT u.id,u.first_name,u.last_name,u.blood_group,u.city,d.is_available FROM users u JOIN donors d ON u.id=d.user_id WHERE u.role=\'donor\' AND u.is_active=1 AND d.is_available=1 AND u.blood_group IN ('+compatible.map(()=>'?').join(',')+')';
      const p=[...compatible];
      if (city) { sql+=' AND u.city LIKE ?'; p.push('%'+city+'%'); }
      sql+=' LIMIT 20';
      const [donors] = await db.execute(sql,p);
      return res.json({ parsed:{query:q,bloodGroup,city,urgent}, compatibleGroups:compatible, count:donors.length, donors, message:'Found '+donors.length+' donors for '+bloodGroup+(city?' in '+city:'') });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  const f = demoDonors.filter(d=>compatible.includes(d.blood_group)&&d.is_available===1&&(!city||d.city.toLowerCase().includes(city.toLowerCase())));
  res.json({ parsed:{query:q,bloodGroup,city,urgent}, compatibleGroups:compatible, count:f.length, donors:f, message:'Found '+f.length+' donors for '+bloodGroup+(city?' in '+city:'') });
});

// GET /api/compatibility/:bloodGroup
app.get('/api/certificate', async (req, res) => {
  const bg = decodeURIComponent(req.params.bloodGroup);
  const info = compatibilityMap[bg];
  if (!info) return res.status(404).json({ message: '"'+bg+'" not found. Valid: A+, A-, B+, B-, AB+, AB-, O+, O-' });
  res.json({ bloodGroup:bg, canDonate:info.canDonate, canReceive:info.canReceive, isUniversalDonor:bg==='O-', isUniversalReceiver:bg==='AB+', description:bg+' can donate to: '+info.canDonate.join(', ')+'. Can receive from: '+info.canReceive.join(', ')+'.' });
});

// GET /api/donor/dashboard
app.get('/api/donor/dashboard', auth, requireRole('donor'), async (req, res) => {
  if (db) {
    try {
      const [rows] = await db.execute('SELECT u.*,d.last_donation_date,d.donation_count,d.is_available FROM users u JOIN donors d ON u.id=d.user_id WHERE u.id=?',[req.user.id]);
      if (!rows.length) return res.status(404).json({ message: 'Donor not found.' });
      const u = rows[0];
      const [history]  = await db.execute('SELECT * FROM donation_history WHERE donor_id=? ORDER BY donated_at DESC LIMIT 10',[req.user.id]);
      const [requests] = await db.execute("SELECT br.*,u.first_name,u.last_name,u.city FROM blood_requests br JOIN users u ON br.requester_id=u.id WHERE br.blood_group=? AND br.status='pending' LIMIT 5",[u.blood_group]);
      const [alerts]   = await db.execute('SELECT a.*,h.hospital_name FROM alerts a JOIN hospitals h ON a.hospital_user_id=h.user_id WHERE a.blood_group=? ORDER BY a.created_at DESC LIMIT 5',[u.blood_group]);
      let nextEligible=null;
      if (u.last_donation_date) { const d=new Date(u.last_donation_date); d.setDate(d.getDate()+56); nextEligible=d.toISOString().split('T')[0]; }
      return res.json({ user:{id:u.id,name:u.first_name+' '+u.last_name,firstName:u.first_name,bloodGroup:u.blood_group,city:u.city,phone:u.phone,isAvailable:u.is_available,donationCount:u.donation_count,lastDonation:u.last_donation_date,nextEligible,isEligible:!nextEligible||new Date()>=new Date(nextEligible)}, donationHistory:history, pendingRequests:requests, recentAlerts:alerts, compatibility:compatibilityMap[u.blood_group]||{} });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ user:{id:1,name:'Rahul Sharma',firstName:'Rahul',bloodGroup:'O+',city:'Hyderabad',isAvailable:1,donationCount:5,lastDonation:'2024-10-15',nextEligible:'2024-12-10',isEligible:true}, donationHistory:[{id:1,donated_at:'2024-10-15',hospital_name:'Apollo Hospital',units:1},{id:2,donated_at:'2024-02-20',hospital_name:'KIMS Hospital',units:1}], pendingRequests:[{id:1,blood_group:'O+',hospital:'Apollo Hospital',city:'Hyderabad',urgency:'HIGH',first_name:'Aman',last_name:'Verma'}], recentAlerts:[{id:1,blood_group:'O-',city:'Hyderabad',urgency:'CRITICAL',hospital_name:'Apollo Hospital',created_at:new Date()}], compatibility:compatibilityMap['O+'] });
});

// PUT /api/donor/availability
app.put('/api/donor/availability', auth, requireRole('donor'), async (req, res) => {
  const { isAvailable } = req.body;
  if (db) {
    try {
      await db.execute('UPDATE donors SET is_available=? WHERE user_id=?',[isAvailable?1:0,req.user.id]);
      return res.json({ message:'Availability updated!', isAvailable });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ message:'Availability updated (Demo mode)', isAvailable });
});

// POST /api/donation/record
app.post('/api/donation/record', auth, requireRole('donor'), async (req, res) => {
  const { donatedAt, hospitalName, units } = req.body;
  if (!donatedAt||!hospitalName) return res.status(400).json({ message: 'Donation date and hospital name required.' });
  if (db) {
    try {
      await db.execute('INSERT INTO donation_history (donor_id,donated_at,hospital_name,units) VALUES (?,?,?,?)',[req.user.id,donatedAt,hospitalName,units||1]);
      await db.execute('UPDATE donors SET last_donation_date=?,donation_count=donation_count+1 WHERE user_id=?',[donatedAt,req.user.id]);
      return res.json({ message:'Donation recorded successfully!' });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ message:'Donation recorded! (Demo mode)' });
});

// GET /api/receiver/dashboard
app.get('/api/receiver/dashboard', auth, requireRole('receiver'), async (req, res) => {
  if (db) {
    try {
      const [rows] = await db.execute('SELECT * FROM users WHERE id=?',[req.user.id]);
      const u = rows[0];
      const compatible = compatibilityMap[u.blood_group]?.canReceive || [];
      const [requests] = await db.execute('SELECT * FROM blood_requests WHERE requester_id=? ORDER BY created_at DESC LIMIT 10',[req.user.id]);
      let donors=[];
      if (compatible.length) {
        const [d] = await db.execute('SELECT u.id,u.first_name,u.last_name,u.blood_group,u.city,d.is_available FROM users u JOIN donors d ON u.id=d.user_id WHERE u.role=\'donor\' AND u.is_active=1 AND d.is_available=1 AND u.blood_group IN ('+compatible.map(()=>'?').join(',')+')'+(u.city?' AND u.city LIKE ?':''),u.city?[...compatible,'%'+u.city+'%']:compatible);
        donors=d;
      }
      return res.json({ user:{id:u.id,name:u.first_name+' '+u.last_name,bloodGroup:u.blood_group,city:u.city}, myRequests:requests, compatibleDonors:donors, compatibleGroups:compatible });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  const compatible = compatibilityMap['B+']?.canReceive || [];
  res.json({ user:{id:2,name:'Aman Verma',bloodGroup:'B+',city:'Hyderabad'}, myRequests:[], compatibleDonors:demoDonors.filter(d=>compatible.includes(d.blood_group)&&d.is_available===1), compatibleGroups:compatible });
});

// POST /api/request
app.post('/api/request', auth, requireRole('receiver'), async (req, res) => {
  const { bloodGroup, units, hospital, city, urgency, notes } = req.body;
  if (!bloodGroup) return res.status(400).json({ message: 'bloodGroup required.' });
  if (db) {
    try {
      const [r] = await db.execute("INSERT INTO blood_requests (requester_id,blood_group,units,hospital,city,urgency,notes,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',NOW())",[req.user.id,bloodGroup,units||1,hospital||null,city||null,urgency||'NORMAL',notes||null]);
      return res.status(201).json({ message:'Blood request created!', requestId:r.insertId });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.status(201).json({ message:'Blood request created! (Demo mode)', requestId:999 });
});

// GET /api/requests
app.get('/api/requests', auth, async (req, res) => {
  const { bloodGroup, city, urgency } = req.query;
  if (db) {
    try {
      let sql = "SELECT br.*,u.first_name,u.last_name FROM blood_requests br JOIN users u ON br.requester_id=u.id WHERE br.status='pending'";
      const p=[];
      if (bloodGroup) { sql+=' AND br.blood_group=?'; p.push(bloodGroup); }
      if (city)       { sql+=' AND br.city LIKE ?';   p.push('%'+city+'%'); }
      if (urgency)    { sql+=' AND br.urgency=?';     p.push(urgency); }
      sql+=" ORDER BY FIELD(br.urgency,'CRITICAL','HIGH','NORMAL','LOW'),br.created_at DESC";
      const [requests] = await db.execute(sql,p);
      return res.json({ count:requests.length, requests });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ count:2, requests:[{id:1,blood_group:'B+',units:2,hospital:'Apollo Hospital',city:'Hyderabad',urgency:'HIGH',status:'pending',first_name:'Aman',last_name:'Verma'},{id:2,blood_group:'O+',units:1,hospital:'KIMS Hospital',city:'Hyderabad',urgency:'NORMAL',status:'pending',first_name:'Sunita',last_name:'Patel'}] });
});

// GET /api/hospital/dashboard
app.get('/api/hospital/dashboard', auth, requireRole('hospital'), async (req, res) => {
  if (db) {
    try {
      const [rows] = await db.execute('SELECT u.*,h.hospital_name,h.license_number,h.blood_stock_json FROM users u JOIN hospitals h ON u.id=h.user_id WHERE u.id=?',[req.user.id]);
      const h=rows[0];
      const [alerts]   = await db.execute('SELECT * FROM alerts WHERE hospital_user_id=? ORDER BY created_at DESC LIMIT 10',[req.user.id]);
      const [requests] = await db.execute("SELECT br.*,u.first_name,u.last_name,u.blood_group FROM blood_requests br JOIN users u ON br.requester_id=u.id WHERE br.status='pending' ORDER BY FIELD(br.urgency,'CRITICAL','HIGH','NORMAL','LOW'),br.created_at DESC LIMIT 20");
      return res.json({ hospital:{id:h.id,name:h.hospital_name,city:h.city,license:h.license_number,bloodStock:JSON.parse(h.blood_stock_json||'{}')}, recentAlerts:alerts, pendingRequests:requests });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ hospital:{id:3,name:'Apollo Hospital Hyderabad',city:'Hyderabad',bloodStock:{'A+':8,'A-':2,'B+':12,'B-':1,'AB+':4,'AB-':1,'O+':15,'O-':3}}, recentAlerts:[{id:1,blood_group:'O-',city:'Hyderabad',urgency:'CRITICAL',donor_count:12,hospital_name:'Apollo Hospital',created_at:new Date()}], pendingRequests:[{id:1,blood_group:'B+',units:2,hospital:'Apollo',city:'Hyderabad',urgency:'HIGH',first_name:'Aman',last_name:'Verma'}] });
});

// PUT /api/hospital/stock
app.put('/api/hospital/stock', auth, requireRole('hospital'), async (req, res) => {
  const { stock } = req.body;
  if (!stock) return res.status(400).json({ message: 'Stock data required.' });
  if (db) {
    try {
      await db.execute('UPDATE hospitals SET blood_stock_json=? WHERE user_id=?',[JSON.stringify(stock),req.user.id]);
      return res.json({ message:'Blood stock updated!', stock });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ message:'Stock updated (Demo mode)', stock });
});

// POST /api/alerts
app.post('/api/alerts', auth, requireRole('hospital'), async (req, res) => {
  const { bloodGroup, city, units, message, urgency } = req.body;
  if (!bloodGroup) return res.status(400).json({ message: 'bloodGroup required.' });
  const compatible = compatibilityMap[bloodGroup]?.canReceive || [bloodGroup];
  if (db) {
    try {
      let sql = 'SELECT u.id,u.first_name,u.email FROM users u JOIN donors d ON u.id=d.user_id WHERE u.role=\'donor\' AND u.is_active=1 AND d.is_available=1 AND u.blood_group IN ('+compatible.map(()=>'?').join(',')+')';;
      const p=[...compatible];
      if (city) { sql+=' AND u.city LIKE ?'; p.push('%'+city+'%'); }
      const [donors] = await db.execute(sql,p);
      const [r] = await db.execute('INSERT INTO alerts (hospital_user_id,blood_group,city,units,message,urgency,donor_count,created_at) VALUES (?,?,?,?,?,?,?,NOW())',[req.user.id,bloodGroup,city||null,units||1,message||'Emergency: '+bloodGroup+' blood needed',urgency||'HIGH',donors.length]);
      return res.json({ message:'Alert sent to '+donors.length+' donors!', alertId:r.insertId, donorsNotified:donors.length, bloodGroup });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  const n = demoDonors.filter(d=>compatible.includes(d.blood_group)&&d.is_available===1).length;
  res.json({ message:'Alert sent to '+n+' donors (Demo mode)', alertId:999, donorsNotified:n, bloodGroup });
});

// GET /api/alerts
app.get('/api/alerts', async (req, res) => {
  if (db) {
    try {
      const [alerts] = await db.execute('SELECT a.*,h.hospital_name FROM alerts a JOIN hospitals h ON a.hospital_user_id=h.user_id ORDER BY a.created_at DESC LIMIT 20');
      return res.json({ count:alerts.length, alerts });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ count:2, alerts:[{id:1,blood_group:'O-',city:'Hyderabad',urgency:'CRITICAL',units:3,donor_count:12,hospital_name:'Apollo Hospital',created_at:new Date(),is_resolved:0},{id:2,blood_group:'A+',city:'Hyderabad',urgency:'HIGH',units:2,donor_count:8,hospital_name:'KIMS Hospital',created_at:new Date(),is_resolved:0}] });
});

// GET /api/reminders
app.get('/api/reminders', auth, async (req, res) => {
  if (db) {
    try {
      const [donors] = await db.execute("SELECT u.id,u.first_name,u.last_name,u.email,u.blood_group,u.city,d.last_donation_date FROM users u JOIN donors d ON u.id=d.user_id WHERE u.role='donor' AND u.is_active=1 AND (d.last_donation_date IS NULL OR DATE_ADD(d.last_donation_date,INTERVAL 56 DAY)<=CURDATE()) ORDER BY d.last_donation_date ASC");
      return res.json({ message:donors.length+' donors eligible to donate', count:donors.length, donors });
    } catch(e) { return res.status(500).json({ message: e.message }); }
  }
  res.json({ message:'2 donors eligible (Demo mode)', count:2, donors:demoDonors.slice(0,2) });
});

// CATCH-ALL — Express 5 syntax
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n🩸 eBloodBank running → http://localhost:'+PORT);
  console.log('🔗 Test APIs     → http://localhost:'+PORT+'/api/test\n');
});