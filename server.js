require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Import cors middleware

const app = express();
const PORT = process.env.PORT || 3000; // Use port from environment or default to 3000

// --- Middleware ---
// Enable CORS for your frontend domain
// IMPORTANT: Replace 'https://abs.ananuniversity.edu.ng' with your actual frontend domain
// If you have multiple domains, you can specify them in an array or use a function.
// For development, you can use '*' but NEVER in production.
app.use(cors({
    origin: 'https://abs.ananuniversity.edu.ng' // Your frontend's domain
}));

app.use(express.json()); // Enable parsing of JSON request bodies

// --- Configuration ---
const ZAINPAY_SECRET_KEY = process.env.ZAINPAY_SECRET_KEY; // Your ZainPay Secret Key (from .env)
const ZAINBOX_CODE = process.env.ZAINBOX_CODE;         // Your Zainbox Code (from .env)

// ZainPay API Endpoint for server-to-server calls
const ZAINPAY_API_URL = "https://api.zainpay.ng/v1/merchant/initialize/payment"; // This is the URL your backend calls.
const CALLBACK_URL = "https://abs.ananuniversity.edu.ng/payment-success"; // Your frontend success page
const LOGO_URL = "https://abs.ananuniversity.edu.ng/wp-content/uploads/2025/05/WhatsApp-Image-2025-05-01-at-10.04.58.jpeg";

// --- Fee Structure (for secure server-side calculation) ---
// This data should be securely managed, ideally from a database,
// but for this example, we'll keep it as a constant.
const feeStructure = {
    DBA: 1158650, DBA_PFG: 1158650, DBA_CGL: 1158650, DBA_AIS: 1158650, DBA_AFI: 1158650,
    DBA_ENT: 1158650, DBA_PAP: 1158650, DBA_TECH: 1158650, DBA_DSA: 1158650, DBA_HMN: 1158650,
    DBA_PSM: 1158650, DBA_PM: 1158650, DBA_EE: 1158650, DBA_HRM: 1158650, DBA_MM: 1158650,
    DPA: 816450, DPA_SSS: 816450, DPA_LDS: 816450,
    MPFG: 581450, MCGL: 581450, MAIS: 581450, MAFI: 581450, MENT: 581450, MSSS: 581450,
    MTFP: 581450, MLDS: 581450, MPAP: 581450, MPSS: 581450, MEE: 581450, MFIN: 581450,
    MDATA: 581450, MPRO: 581450, MHRM: 581450, MMAR: 581450, MICM: 581450,
    MBA: 816450, MScA: 816450, MPhilA: 816450,
    PGD_ACC: 275000, PGD_MGMT: 275000
};

// --- Helper function for server-side amount calculation ---
function calculatePaymentServer(program, percentage) {
    const totalFee = feeStructure[program] || 0;
    const schoolFees = (totalFee * percentage) / 100;
    const bankCharges = schoolFees * 0.02; // Assuming 2% bank charges
    const totalAmount = schoolFees + bankCharges; // This will be in Naira
    return {
        totalFee,
        schoolFees,
        bankCharges,
        totalAmount
    };
}


// --- API Endpoints ---

// Endpoint to provide fee structure to the frontend
app.get('/api/fees', (req, res) => {
    res.json({ feeStructure });
});

// Endpoint to calculate payment breakdown for frontend display
app.post('/api/calculate-payment', (req, res) => {
    const { program, percentage } = req.body;
    if (!program || isNaN(percentage)) {
        return res.status(400).json({ message: 'Program and percentage are required for calculation.' });
    }
    const paymentDetails = calculatePaymentServer(program, percentage);
    res.json(paymentDetails);
});

// Primary Endpoint: Initiate Payment
app.post('/api/initiate-payment', async (req, res) => {
    const { fullName, email, phone, gender, program, percentage } = req.body;

    // 1. Basic Server-Side Validation
    if (!fullName || !email || !phone || !gender || !program || isNaN(percentage)) {
        console.error('Validation Error: Missing required fields in request body.');
        return res.status(400).json({ message: 'Missing required payment details.' });
    }
    if (!ZAINPAY_SECRET_KEY || !ZAINBOX_CODE) {
        console.error('Server Configuration Error: ZAINPAY_SECRET_KEY or ZAINBOX_CODE is not set.');
        return res.status(500).json({ message: 'Server is not configured with payment keys.' });
    }

    try {
        // 2. Securely Calculate Amount (always re-calculate on backend)
        const paymentDetails = calculatePaymentServer(program, percentage);
        // ZainPay's documentation states 'amount' parameter should be in Naira,
        // but their webhook notification payload will be in kobo.
        // So, we send Naira to the API, and they might convert it internally.
        const amountInNaira = Math.round(paymentDetails.totalAmount);
        const txnRef = `ANAN-${Date.now()}-${phone.replace(/\D/g, '')}`; // Generate a unique transaction reference

        console.log(`Initiating payment for ${email} with amount ${amountInNaira} Naira and ref ${txnRef}`);

        // 3. Make Server-to-Server Call to ZainPay
        const zainpayResponse = await axios.post(ZAINPAY_API_URL,
            {
                amount: amountInNaira, // Send amount in Naira as per ZainPay docs
                txnRef: txnRef,
                mobileNumber: phone,
                emailAddress: email,
                zainboxCode: ZAINBOX_CODE,
                callbackUrl: CALLBACK_URL,
                logoUrl: LOGO_URL
            },
            {
                headers: {
                    'Authorization': `Bearer ${ZAINPAY_SECRET_KEY}`, // *** USE SECRET KEY HERE ***
                    'Content-Type': 'application/json'
                }
            }
        );

        // 4. Handle ZainPay's Response
        if (zainpayResponse.data && zainpayResponse.data.paymentUrl) {
            console.log('Payment initiated successfully via ZainPay. Redirecting...');
            return res.json({ payment_url: zainpayResponse.data.paymentUrl });
        } else {
            console.error('ZainPay API Response Error: Missing paymentUrl or invalid data.', zainpayResponse.data);
            return res.status(500).json({ message: 'Failed to obtain payment URL from ZainPay. Invalid response.' });
        }

    } catch (error) {
        // 5. Error Handling & Logging
        console.error('Error in /api/initiate-payment:', error);
        if (error.response) {
            // ZainPay API responded with an error status (e.g., 400, 401, 500)
            console.error('ZainPay API Error Data:', error.response.data);
            console.error('ZainPay API Error Status:', error.response.status);
            console.error('ZainPay API Error Headers:', error.response.headers);
            return res.status(error.response.status || 500).json({
                message: `ZainPay API Error: ${error.response.data?.message || 'Unknown API error'}`,
                details: error.response.data // Pass back more details for debugging
            });
        } else if (error.request) {
            // The request was made but no response was received (network error, timeout)
            console.error('No response received from ZainPay API:', error.request);
            return res.status(504).json({ message: 'Payment gateway did not respond. Please try again.' });
        } else {
            // Something else happened in setting up the request that triggered an Error
            console.error('Error setting up request to ZainPay:', error.message);
            return res.status(500).json({ message: `Internal server error: ${error.message}` });
        }
    }
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log(`CORS enabled for origin: ${process.env.NODE_ENV === 'production' ? 'Your Production Frontend URL' : 'https://abs.ananuniversity.edu.ng'}`); // Adjust message for production
});
