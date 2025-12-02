import { v4 as uuidv4 } from "uuid";
import { loadTournaments, saveTournaments, getTournamentById, ensureUser, saveUserBSON } from "c:/Users/shubham maurya/Desktop/open ai/utils/storage.js";
import { verifyRazorpaySignature, shortReceipt } from "c:/Users/shubham maurya/Desktop/open ai/utils/helpers.js";
import { ADMIN_NUMBER, SERVER_BASE, razorpay, waClient, waReady } from "c:/Users/shubham maurya/Desktop/open ai/server.js";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_ngfuwNT5GKWz6N";

export function setupPaymentRoutes(app) {
  // Payment page - user opens this to pay
  app.get('/pay/:tId/:number', async (req, res) => {
    try {
      const { tId, number } = req.params;
      const list = loadTournaments();
      const t = list.find(x => x.id === tId);
      if (!t) return res.status(404).send('Tournament not found');

      t.participants = t.participants || [];
      let p = t.participants.find(x => x.number === number);
      if (!p) return res.status(404).send('<h3>No join request found. Send "join" on WhatsApp first.</h3>');
      if (p.paid) return res.send('<h3>✅ Payment already received. Registration confirmed.</h3>');

      // Check link expiry
      if (!p.paymentLink || Date.now() > p.paymentLinkExpires) {
        return res.send('<h3>Payment link expired. Send "join" again on WhatsApp to get a new link.</h3>');
      }

      const user = ensureUser(number);
      const walletBalance = user.wallet || 0;
      let amountFromWallet = 0;
      let amountFromRazorpay = t.fee;

      if (walletBalance > 0) {
        if (walletBalance >= t.fee) {
          // Full amount from wallet
          amountFromWallet = t.fee;
          amountFromRazorpay = 0;
        } else {
          // Partial from wallet
          amountFromWallet = walletBalance;
          amountFromRazorpay = t.fee - walletBalance;
        }
      }

      p.walletDeduction = amountFromWallet;
      p.razorpayAmount = amountFromRazorpay;
      saveTournaments(list);

      // Full payment from wallet
      if (amountFromRazorpay === 0) {
        user.wallet = (user.wallet || 0) - amountFromWallet;
        user.history = user.history || [];
        user.history.push({
          tournamentId: t.id,
          action: 'wallet_deduct',
          at: Date.now(),
          amount: amountFromWallet
        });
        saveUserBSON(number, user);

        p.paid = true;
        p.payment = { type: 'wallet', amount: amountFromWallet, at: Date.now() };
        saveTournaments(list);

        if (!user.joinedTournaments.find(x => x.tournamentId === tId)) {
          user.joinedTournaments.push({ tournamentId: tId, tournamentTitle: t.title, joinedAt: Date.now(), paid: true });
        } else {
          const jt = user.joinedTournaments.find(x => x.tournamentId === tId);
          jt.paid = true;
        }
        saveUserBSON(number, user);

        try { if (waReady) await waClient.sendMessage(`${number}@c.us`, `✅ Registration confirmed for ${t.title}\n💳 Paid from wallet: ₹${amountFromWallet}\n💰 Remaining: ₹${user.wallet}`); } catch (e) { }
        try { if (waReady) await waClient.sendMessage(`${ADMIN_NUMBER}@c.us`, `Wallet Payment: ${number} for ${t.title} (₹${amountFromWallet})`); } catch (e) { }

        return res.send('<h3>✅ Payment successful via wallet! Registration confirmed.</h3>');
      }

      // Razorpay payment needed
      const order = await razorpay.orders.create({
        amount: amountFromRazorpay * 100,
        currency: 'INR',
        receipt: shortReceipt(),
        payment_capture: 1,
      });

      const checkoutHTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pay ₹${amountFromRazorpay}</title>
  <style>
    body { font-family: 'Segoe UI', Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 400px; text-align: center; }
    h1 { color: #333; margin: 0 0 10px 0; font-size: 24px; }
    .details { background: #f8f9fa; padding: 15px; border-radius: 10px; margin: 20px 0; text-align: left; }
    .detail-row { display: flex; justify-content: space-between; margin: 8px 0; font-size: 14px; }
    .detail-row strong { color: #333; }
    .detail-row span { color: #666; }
    .amount-box { background: #667eea; color: white; padding: 20px; border-radius: 10px; margin: 20px 0; }
    .amount-box p { margin: 8px 0; font-size: 14px; }
    .amount-box .total { font-size: 28px; font-weight: bold; margin-top: 10px; }
    button { width: 100%; padding: 15px; background: #667eea; color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.3s; }
    button:hover { background: #764ba2; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎮 Tournament Payment</h1>
    <div class="details">
      <div class="detail-row"><strong>Tournament:</strong> <span>${t.title}</span></div>
      <div class="detail-row"><strong>Total Fee:</strong> <span>₹${t.fee}</span></div>
      <div class="detail-row"><strong>From Wallet:</strong> <span style="color: #28a745;">-₹${amountFromWallet}</span></div>
      <div class="detail-row"><strong>Pay Now:</strong> <span style="color: #dc3545;">₹${amountFromRazorpay}</span></div>
    </div>
    <div class="amount-box">
      <p>Amount to Pay</p>
      <div class="total">₹${amountFromRazorpay}</div>
    </div>
    <button id="rzp-button">Pay Securely</button>
  </div>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    const options = {
      key: '${RAZORPAY_KEY_ID}',
      amount: ${order.amount},
      currency: 'INR',
      name: '${t.title}',
      order_id: '${order.id}',
      handler: function (response) {
        fetch('/payment/success', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            tournamentId: '${t.id}',
            number: '${number}',
            amountFromWallet: ${amountFromWallet}
          })
        }).then(r => r.json()).then(j => {
          alert(j.message || 'Success!');
          window.close();
        }).catch(e => { alert('Error: ' + e.message); });
      },
      theme: { color: '#667eea' }
    };
    const rzp = new Razorpay(options);
    document.getElementById('rzp-button').onclick = function (e) {
      rzp.open();
      e.preventDefault();
    }
  </script>
</body>
</html>`;
      res.send(checkoutHTML);

    } catch (e) {
      console.error("pay err:", e);
      res.status(500).send('Payment initiation failed');
    }
  });

  // Payment success callback
  app.post('/payment/success', async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, tournamentId, number, amountFromWallet } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'missing fields' });
      }

      const ok = verifyRazorpaySignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature });
      if (!ok) return res.status(400).json({ error: 'signature mismatch' });

      const list = loadTournaments();
      const t = list.find(x => x.id === tournamentId);
      if (!t) return res.status(404).json({ error: 't not found' });

      t.participants = t.participants || [];
      let p = t.participants.find(x => x.number === number);
      if (!p) {
        p = {
          id: uuidv4(),
          number,
          joinedAt: Date.now(),
          paid: true,
          payment: { id: razorpay_payment_id, order: razorpay_order_id, at: Date.now() }
        };
        t.participants.push(p);
      } else {
        p.paid = true;
        p.payment = { id: razorpay_payment_id, order: razorpay_order_id, at: Date.now() };
      }
      saveTournaments(list);

      const user = ensureUser(number);
      const walletDeduction = amountFromWallet || 0;

      user.wallet = (user.wallet || 0) - walletDeduction;
      user.history = user.history || [];

      if (walletDeduction > 0) {
        user.history.push({ tournamentId, action: 'wallet_deduct', at: Date.now(), amount: walletDeduction });
      }

      const razorpayAmount = t.fee - walletDeduction;
      if (razorpayAmount > 0) {
        user.history.push({ tournamentId, action: 'paid', at: Date.now(), amount: razorpayAmount, paymentId: razorpay_payment_id });
      }

      if (!user.joinedTournaments.find(x => x.tournamentId === tournamentId)) {
        user.joinedTournaments.push({ tournamentId, tournamentTitle: t.title, joinedAt: Date.now(), paid: true });
      } else {
        const jt = user.joinedTournaments.find(x => x.tournamentId === tournamentId);
        jt.paid = true;
      }
      saveUserBSON(number, user);

      const userMsg = walletDeduction > 0
        ? `✅ Payment received for ${t.title}\n💳 Razorpay: ₹${razorpayAmount}\n💰 Wallet: ₹${walletDeduction}\nRemaining: ₹${user.wallet}`
        : `✅ Registration confirmed for ${t.title}`;

      try { if (waReady) await waClient.sendMessage(`${number}@c.us`, userMsg); } catch (e) { }
      try { if (waReady) await waClient.sendMessage(`${ADMIN_NUMBER}@c.us`, `Payment: ${number} for ${t.title} (₹${razorpayAmount} paid${walletDeduction > 0 ? `, ₹${walletDeduction} wallet` : ''})`); } catch (e) { }

      return res.json({ message: 'Payment successful!' });
    } catch (e) {
      console.error("payment success err", e);
      return res.status(500).json({ error: 'internal' });
    }
  });
}
