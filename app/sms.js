/**
 * ═══════════════════════════════════════════════════════
 *  eBloodBank — SMS Alerts Module (Twilio)
 *  File: sms.js
 *  
 *  SETUP:
 *  1. npm install twilio
 *  2. Add to .env:
 *     TWILIO_SID=your_account_sid
 *     TWILIO_TOKEN=your_auth_token
 *     TWILIO_PHONE=+1234567890
 *  3. require('./sms') in server.js
 * ═══════════════════════════════════════════════════════
 * 
 *  HOW TO GET TWILIO CREDENTIALS (FREE):
 *  1. Go to https://www.twilio.com/try-twilio
 *  2. Sign up for a FREE trial account
 *  3. Get a free phone number
 *  4. Copy Account SID and Auth Token
 *  5. Add them to your .env file
 *  6. Free trial gives you $15 credit = ~500 SMS
 */

require('dotenv').config();

/* ══════════════════════════════════════
   TWILIO CLIENT SETUP
══════════════════════════════════════ */
let twilioClient = null;
let twilioPhone  = null;

function initTwilio() {
  const sid   = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const phone = process.env.TWILIO_PHONE;

  if (!sid || !token || !phone) {
    console.log('⚠️  Twilio not configured — SMS disabled');
    console.log('   Add TWILIO_SID, TWILIO_TOKEN, TWILIO_PHONE to .env');
    return false;
  }

  try {
    const twilio = require('twilio');
    twilioClient = twilio(sid, token);
    twilioPhone  = phone;
    console.log('✅ Twilio SMS configured — ' + phone);
    return true;
  } catch (err) {
    console.log('⚠️  Twilio package not installed. Run: npm install twilio');
    return false;
  }
}

const smsEnabled = initTwilio();

/* ══════════════════════════════════════
   SMS TEMPLATES
══════════════════════════════════════ */
const SMS = {

  // Emergency alert to donor
  emergencyAlert: (donor, bloodGroup, hospitalName, city, units) => `
🚨 URGENT BLOOD NEEDED — eBloodBank

Hi ${donor.first_name},

${bloodGroup} blood is urgently needed!
📍 Location: ${city}
🏥 Hospital: ${hospitalName || 'Nearby Hospital'}
💉 Units: ${units || 1}

You are compatible to donate!
Please respond ASAP to save a life.

Reply STOP to unsubscribe.
eBloodBank.in`.trim(),

  // Donation reminder
  donationReminder: (donor) => `
💉 Time to Donate Again! — eBloodBank

Hi ${donor.first_name},

It's been 56+ days since your last donation!
You are now eligible to donate ${donor.blood_group} blood.

Your donation can save up to 3 lives! 🩸

Login to eBloodBank to find a nearby blood bank.

Reply STOP to unsubscribe.
eBloodBank.in`.trim(),

  // Welcome SMS on registration
  welcome: (user) => `
🩸 Welcome to eBloodBank!

Hi ${user.firstName},

Your ${user.role} account has been created successfully.

Blood Group: ${user.bloodGroup || 'Not set'}
City: ${user.city || 'Not set'}

You will now receive emergency blood alerts for your area.

Thank you for joining! Together we save lives.
eBloodBank.in`.trim(),

  // Request accepted by donor
  requestAccepted: (receiver, donorName, bloodGroup) => `
✅ Good News — eBloodBank

Hi ${receiver.first_name},

A donor has accepted your blood request!

🩸 Blood Group: ${bloodGroup}
👤 Donor: ${donorName}

The donor will contact you soon.
Please keep your phone available.

eBloodBank.in`.trim(),

  // Blood request to hospital
  hospitalAlert: (hospital, bloodGroup, units, city) => `
🏥 Blood Request — eBloodBank

Hi ${hospital.hospital_name},

A patient needs blood urgently:
🩸 Blood Group: ${bloodGroup}
💉 Units: ${units}
📍 Location: ${city}

Please check your eBloodBank dashboard.

eBloodBank.in`.trim(),

};

/* ══════════════════════════════════════
   SEND SINGLE SMS
══════════════════════════════════════ */
async function sendSMS(phone, message) {
  // Format phone number for India
  let formatted = phone.toString().trim();
  if (!formatted.startsWith('+')) {
    // Assume India (+91) if no country code
    formatted = formatted.replace(/^0/, ''); // remove leading 0
    if (formatted.length === 10) {
      formatted = '+91' + formatted;
    } else if (!formatted.startsWith('91')) {
      formatted = '+91' + formatted;
    } else {
      formatted = '+' + formatted;
    }
  }

  if (!smsEnabled || !twilioClient) {
    console.log('📱 SMS (DEMO) to ' + formatted + ': ' + message.substring(0, 50) + '...');
    return { success: true, demo: true, to: formatted };
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: twilioPhone,
      to:   formatted
    });
    console.log('✅ SMS sent to ' + formatted + ' — SID: ' + result.sid);
    return { success: true, sid: result.sid, to: formatted };
  } catch (err) {
    console.error('❌ SMS failed to ' + formatted + ':', err.message);
    return { success: false, error: err.message, to: formatted };
  }
}

/* ══════════════════════════════════════
   SEND BULK SMS (to multiple donors)
══════════════════════════════════════ */
async function sendBulkSMS(donors, messageFunc) {
  const results = { sent: 0, failed: 0, demo: 0, errors: [] };

  for (const donor of donors) {
    if (!donor.phone) {
      results.failed++;
      continue;
    }

    try {
      const message = messageFunc(donor);
      const result  = await sendSMS(donor.phone, message);

      if (result.success) {
        if (result.demo) results.demo++;
        else results.sent++;
      } else {
        results.failed++;
        results.errors.push({ phone: donor.phone, error: result.error });
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      results.failed++;
    }
  }

  return results;
}

/* ══════════════════════════════════════
   EXPORTED FUNCTIONS
══════════════════════════════════════ */

/**
 * Send emergency blood alert SMS to all compatible donors
 * @param {Array} donors - List of donor objects with phone numbers
 * @param {string} bloodGroup - Blood group needed
 * @param {string} hospitalName - Hospital name
 * @param {string} city - City
 * @param {number} units - Units needed
 */
async function sendEmergencyAlertSMS(donors, bloodGroup, hospitalName, city, units) {
  console.log(`📱 Sending emergency SMS to ${donors.length} donors...`);
  const results = await sendBulkSMS(donors, (donor) =>
    SMS.emergencyAlert(donor, bloodGroup, hospitalName, city, units)
  );
  console.log(`📱 SMS results: ${results.sent} sent, ${results.demo} demo, ${results.failed} failed`);
  return results;
}

/**
 * Send donation reminder SMS
 * @param {Array} donors - Eligible donors
 */
async function sendDonationReminderSMS(donors) {
  console.log(`📱 Sending reminder SMS to ${donors.length} donors...`);
  const results = await sendBulkSMS(donors, SMS.donationReminder);
  console.log(`📱 Reminder SMS: ${results.sent} sent, ${results.failed} failed`);
  return results;
}

/**
 * Send welcome SMS to new user
 * @param {string} phone - Phone number
 * @param {object} user - User object
 */
async function sendWelcomeSMS(phone, user) {
  if (!phone) return;
  const result = await sendSMS(phone, SMS.welcome(user));
  return result;
}

/**
 * Send request accepted SMS
 */
async function sendRequestAcceptedSMS(receiverPhone, receiverName, donorName, bloodGroup) {
  if (!receiverPhone) return;
  const result = await sendSMS(receiverPhone, SMS.requestAccepted(
    { first_name: receiverName }, donorName, bloodGroup
  ));
  return result;
}

/**
 * Test SMS — send a test message to yourself
 * @param {string} phone - Your phone number
 */
async function testSMS(phone) {
  const result = await sendSMS(phone, `
✅ eBloodBank SMS Test

Your SMS alerts are working correctly!

Time: ${new Date().toLocaleString()}
Status: Active

eBloodBank.in`.trim());
  return result;
}

/* ══════════════════════════════════════
   MODULE EXPORTS
══════════════════════════════════════ */
module.exports = {
  sendEmergencyAlertSMS,
  sendDonationReminderSMS,
  sendWelcomeSMS,
  sendRequestAcceptedSMS,
  testSMS,
  sendSMS,
  smsEnabled
};