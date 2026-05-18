import { Router } from 'express';
import {
  register, login, getMe, updateProfile, updateFullProfile,
  addSavedAddress, deleteSavedAddress,
  getPackages, addPackage, deletePackage,
  getProducts, addProduct, deleteProduct,
  getTickets, createTicket,
} from '../controllers/auth.controller';
import { getRates, bookShipment, confirmPayment, trackShipment, cancelShipment, getMyShipments, downloadLabel } from '../controllers/shipment.controller';
import { createStripeIntent, stripeWebhook, createPayPalOrder, capturePayPalOrder } from '../controllers/payment.controller';
import { getAllShipments, getDashboardStats, updateShipmentStatus, overridePrice, getAllUsers } from '../controllers/admin.controller';
import { authenticate, optionalAuth, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', authenticate, getMe);
router.patch('/auth/profile', authenticate, updateProfile);
router.patch('/auth/profile/full', authenticate, updateFullProfile);
router.post('/auth/addresses', authenticate, addSavedAddress);
router.delete('/auth/addresses/:addressId', authenticate, deleteSavedAddress);

// ── Saved Packages ────────────────────────────────────────────────────────────
router.get('/auth/packages', authenticate, getPackages);
router.post('/auth/packages', authenticate, addPackage);
router.delete('/auth/packages/:packageId', authenticate, deletePackage);

// ── Saved Products ────────────────────────────────────────────────────────────
router.get('/auth/products', authenticate, getProducts);
router.post('/auth/products', authenticate, addProduct);
router.delete('/auth/products/:productId', authenticate, deleteProduct);

// ── Tickets ───────────────────────────────────────────────────────────────────
router.get('/auth/tickets', authenticate, getTickets);
router.post('/auth/tickets', authenticate, createTicket);

// ── Shipments ─────────────────────────────────────────────────────────────────
router.post('/shipments/rates', getRates);
router.post('/shipments/book', optionalAuth, bookShipment);
router.post('/shipments/:id/confirm-payment', optionalAuth, confirmPayment);
router.get('/shipments/track/:trackingNumber', trackShipment);
router.post('/shipments/:id/cancel', optionalAuth, cancelShipment);
router.get('/shipments/my', authenticate, getMyShipments);
router.get('/shipments/:id/label', optionalAuth, downloadLabel);

// ── Payments ──────────────────────────────────────────────────────────────────
router.post('/payments/stripe/intent', optionalAuth, createStripeIntent);
router.post('/payments/stripe/webhook', stripeWebhook);
router.post('/payments/paypal/order', optionalAuth, createPayPalOrder);
router.post('/payments/paypal/capture', optionalAuth, capturePayPalOrder);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/dashboard', authenticate, requireAdmin, getDashboardStats);
router.get('/admin/shipments', authenticate, requireAdmin, getAllShipments);
router.patch('/admin/shipments/:id/status', authenticate, requireAdmin, updateShipmentStatus);
router.patch('/admin/shipments/:id/price', authenticate, requireAdmin, overridePrice);
router.get('/admin/users', authenticate, requireAdmin, getAllUsers);

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'Pilot Courier API', timestamp: new Date() }));

export default router;
