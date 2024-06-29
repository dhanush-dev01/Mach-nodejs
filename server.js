require('dotenv').config()
const express = require('express')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const cors = require('cors')
const VoucherifyClient = require('voucherify');
const TAX_RATE_ID = 'txr_1PSGshSINBqCF5XVmJr9lONc';

const app = express()

app.use(cors())
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const redemptionStore = {};

// app.get('/',(req,res) =>{
//     res.render('index.ejs')
// })

const voucherify = VoucherifyClient({
    
    applicationId: process.env.APPLICATION_ID,
    clientSecretKey: process.env.SECRET_KEY,
    apiUrl: 'https://as1.api.voucherify.io'
});

app.post("/leaderLogin", async (req, res) => {
  const session = await stripe.checkout.sessions.create({
      line_items: [
          {
              price_data: {
                  currency: 'inr',
                  product_data: {
                      name: 'Leader Login'
                  },
                  unit_amount: 199 * 100
              },
              quantity: 1
          },
      ],
      mode: 'payment',
      shipping_address_collection:{
        allowed_countries: ["US", "BR", "IN"]
    },
      success_url: `${process.env.BASE_URL}/login?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/login`
  });
  res.json({ url: session.url });
});

app.get('/verify-session', async (req, res) => {
  const { session_id } = req.query;
  try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
          res.json({ paymentStatus: 'success' });
      } else {
          res.json({ paymentStatus: 'failed' });
      }
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

app.post('/cart-payment', async (req, res) => {
  try {
    const { items, total, couponName, discountAmount } = req.body;
    
    let discounts = [];
    if (discountAmount && discountAmount > 0) {
      // Create a new coupon in Stripe
      const coupon = await stripe.coupons.create({
        amount_off: discountAmount * 100, // Convert to cents
        currency: 'inr',
        name: couponName,
      });

      discounts.push({
        coupon: coupon.id,
      });
    }

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'inr',
        product_data: {
          name: item.name,
          images: [item.image], // Ensure this is an absolute URL
        },
        unit_amount: item.price * 100, // Stripe expects the amount in cents/paise
      },
      quantity: item.quantity,
      tax_rates: [TAX_RATE_ID], // Add the tax rate to each item
    }));

    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: ['US', 'BR', 'IN'],
      },
      discounts: discounts,
      success_url: `${process.env.BASE_URL}/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cart`,
      metadata: {
        couponName: couponName || 'No Coupon Applied', // Include the voucher name in the metadata
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/voucher', (req, res) => {
  const { coupon, amount } = req.body;

  const validationParams = {
    voucher: coupon,
    order: {
      amount: amount * 100 // Amount in cents
    }
  };

  voucherify.validations.validate(validationParams)
    .then(function(result) {
      voucherify.redemptions.redeem(coupon, {
        order: {
          amount: amount * 100 // Order amount in cents
        }
      })
      .then(result => {
        console.log('Redemption successful:', result);
        redemptionStore[coupon] = result.id;
        // console.log(redemptionStore);
        const discountAmount = result.order.total_discount_amount / 100; // Convert cents to rupees
        const couponName = result.voucher.campaign;
        res.json({ success: true, discountAmount, couponName });
      })
      .catch(err => {
        console.error('Redemption failed:', err);
        res.json({ success: false, message: 'Redemption failed' });
      });
    })
    .catch(function(error) {
      console.error('Failed to validate coupon:', error);
      res.json({ success: false, message: 'Validation failed' });
    });
});
  
app.post('/revert-voucher', async (req, res) => {
  const { coupon } = req.body;
  console.log(req.body);
  try {
    // Retrieve the redemption ID from the store
    
    const redemptionId = redemptionStore[coupon];
    // console.log(redemptionStore);
    
    // if (!redemptionId) {
    //   throw new Error('Redemption ID not found for the given coupon');
    // }

    // Rollback using the stored redemption ID
    const result = await voucherify.redemptions.rollback(redemptionId, {
      reason: 'Payment was not completed'
    });

    console.log('Rollback successful:', result);
    res.json({ success: true, message: 'Rollback successful' });

    // Remove the redemption ID from the store
    delete redemptionStore[coupon];
  } catch (err) {
    console.error('Rollback failed:', err);
    res.json({ success: false, message: 'Rollback failed' });
  }
});

app.get('/stripe-session/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    res.json({ payment_status: session.payment_status });
  } catch (error) {
    console.error('Error retrieving Stripe session:', error);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});


  
app.get('/payment-details/:session_id', async (req, res) => {
  const { session_id } = req.params;

  
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id,{
      expand: ['line_items', 'line_items.data.price.product']
    });
    res.json(session);
  } catch (error) {
    console.error('Error retrieving Stripe session:', error);
    res.status(500).json({ error: 'Failed to retrieve session details' });
  }
});


// app.get("/complete",(req,res) =>{
//     res.send("Your payment was successful")
// })

app.get("/cancel",(req,res)=>{
    res.redirect("http://localhost:3000/cart")
})
app.listen(8000,()=> console.log("Server started on port 8000"))