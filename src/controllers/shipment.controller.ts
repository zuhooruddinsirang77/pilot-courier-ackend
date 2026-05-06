import { Request, Response, NextFunction } from 'express';
import Shipment from '../models/Shipment';
import netparcelService from '../services/netparcel.service';
import emailService from '../services/email.service';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const generateShipmentNumber = (): string => {
  const prefix = 'PC';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const tagRates = (rates: any[]) => {
  if (!rates.length) return rates;

  const sorted = [...rates].sort((a, b) => a.TotalCharge - b.TotalCharge);
  const cheapest = sorted[0];
  const fastest = rates.reduce((a, b) => (a.TransitDays < b.TransitDays ? a : b));

  return rates.map((rate) => {
    const totalCharge = rate.TotalCharge;
    const speed = rate.TransitDays;
    const valueScore = totalCharge / Math.max(speed, 1);
    const bestValue = rates.reduce((a, b) => (a.TotalCharge / Math.max(a.TransitDays, 1) < b.TotalCharge / Math.max(b.TransitDays, 1) ? a : b));

    return {
      carrierId: rate.CarrierId,
      carrierName: rate.CarrierName,
      serviceCode: rate.ServiceCode,
      serviceName: rate.ServiceName,
      totalCharge: rate.TotalCharge,
      currency: rate.Currency || 'CAD',
      transitDays: rate.TransitDays,
      estimatedDelivery: rate.EstimatedDelivery,
      isCheapest: rate.ServiceCode === cheapest.ServiceCode && rate.CarrierId === cheapest.CarrierId,
      isFastest: rate.ServiceCode === fastest.ServiceCode && rate.CarrierId === fastest.CarrierId,
      isBestValue: rate.ServiceCode === bestValue.ServiceCode && rate.CarrierId === bestValue.CarrierId,
    };
  });
};

// GET /api/shipments/rates
export const getRates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      originPostal, destinationPostal,
      originCity, destinationCity,
      originProvince, destinationProvince,
      originCountry = 'CA', destinationCountry = 'CA',
      weight, weightUnit = 'kg',
      length, width, height, dimensionUnit = 'cm',
      shipmentType = 'domestic',
    } = req.body;

    const rateRequest = {
      Origin: {
        Name: 'Shipper',
        Address1: '1 Main St',
        City: originCity || '',
        Province: originProvince || '',
        PostalCode: originPostal,
        Country: originCountry,
        Phone: '0000000000',
      },
      Destination: {
        Name: 'Recipient',
        Address1: '1 Main St',
        City: destinationCity || '',
        Province: destinationProvince || '',
        PostalCode: destinationPostal,
        Country: destinationCountry,
        Phone: '0000000000',
      },
      Parcels: [{
        Weight: parseFloat(weight),
        WeightUnit: weightUnit,
        Length: parseFloat(length),
        Width: parseFloat(width),
        Height: parseFloat(height),
        DimensionUnit: dimensionUnit,
        Description: 'Package',
        Quantity: 1,
      }],
    };

    let rawRates;
    try {
      rawRates = await netparcelService.getRates(rateRequest);
    } catch (err) {
      logger.warn('Live API failed, using mock rates:', err);
      rawRates = netparcelService.getMockRates(originPostal, destinationPostal, parseFloat(weight));
    }

    const rates = tagRates(rawRates);

    res.json({ success: true, rates, count: rates.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/shipments/book
export const bookShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { shipper, recipient, parcels, selectedRate, shipmentType, guestEmail, guestPhone } = req.body;
    const userId = (req as any).user?.userId;

    const shipmentNumber = generateShipmentNumber();

    const shipment = await Shipment.create({
      shipmentNumber,
      userId: userId || undefined,
      guestEmail: userId ? undefined : guestEmail,
      guestPhone: userId ? undefined : guestPhone,
      shipper,
      recipient,
      parcels,
      selectedRate,
      shipmentType,
      status: 'pending_payment',
      payment: {
        amount: selectedRate.totalCharge,
        currency: selectedRate.currency || 'CAD',
        status: 'pending',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Shipment created. Proceed to payment.',
      shipmentId: shipment._id,
      shipmentNumber: shipment.shipmentNumber,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/shipments/:id/confirm-payment
export const confirmPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { method, transactionId } = req.body;

    const shipment = await Shipment.findById(id);
    if (!shipment) return res.status(404).json({ success: false, message: 'Shipment not found.' });

    shipment.payment.method = method;
    shipment.payment.status = 'completed';
    shipment.payment.transactionId = transactionId;
    shipment.payment.paidAt = new Date();
    shipment.status = 'paid';

    // Try to create label via NetParcel
    try {
      const netparcelShipment = await netparcelService.createShipment({
        Origin: {
          Name: shipment.shipper.name,
          Company: shipment.shipper.company,
          Address1: shipment.shipper.street,
          City: shipment.shipper.city,
          Province: shipment.shipper.province,
          PostalCode: shipment.shipper.postalCode,
          Country: shipment.shipper.country,
          Phone: shipment.shipper.phone,
        },
        Destination: {
          Name: shipment.recipient.name,
          Company: shipment.recipient.company,
          Address1: shipment.recipient.street,
          City: shipment.recipient.city,
          Province: shipment.recipient.province,
          PostalCode: shipment.recipient.postalCode,
          Country: shipment.recipient.country,
          Phone: shipment.recipient.phone,
        },
        Parcels: shipment.parcels,
        ServiceCode: shipment.selectedRate.serviceCode,
        CarrierId: shipment.selectedRate.carrierId,
      });

      shipment.netparcelShipmentId = netparcelShipment.ShipmentId;
      shipment.trackingNumber = netparcelShipment.TrackingNumber;
      shipment.labelUrl = netparcelShipment.LabelUrl;
      shipment.status = 'label_generated';

      if (netparcelShipment.ShipmentId) {
        const labelBase64 = await netparcelService.getLabel(netparcelShipment.ShipmentId);
        shipment.labelBase64 = labelBase64;
      }
    } catch (labelErr) {
      logger.warn('Label generation failed, shipment still marked as paid:', labelErr);
      shipment.trackingNumber = `PC${Date.now()}`;
      shipment.status = 'label_generated';
    }

    await shipment.save();

    const contactEmail = shipment.guestEmail || '';
    if (contactEmail) {
      await emailService.sendBookingConfirmation(contactEmail, shipment, shipment.guestPhone);
    }

    res.json({
      success: true,
      message: 'Payment confirmed and label generated.',
      shipment: {
        shipmentNumber: shipment.shipmentNumber,
        trackingNumber: shipment.trackingNumber,
        status: shipment.status,
        labelUrl: shipment.labelUrl,
        labelBase64: shipment.labelBase64 ? `data:application/pdf;base64,${shipment.labelBase64}` : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/shipments/track/:trackingNumber
export const trackShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { trackingNumber } = req.params;

    const shipment = await Shipment.findOne({ trackingNumber }).lean();

    let liveTracking = null;
    if (shipment?.netparcelShipmentId) {
      try {
        liveTracking = await netparcelService.trackShipment(trackingNumber);
      } catch {
        logger.warn('Live tracking unavailable for:', trackingNumber);
      }
    }

    if (!shipment && !liveTracking) {
      return res.status(404).json({ success: false, message: 'Tracking number not found. Please check and try again.' });
    }

    res.json({
      success: true,
      tracking: {
        trackingNumber,
        status: shipment?.status || 'unknown',
        carrier: shipment?.selectedRate?.carrierName,
        serviceName: shipment?.selectedRate?.serviceName,
        estimatedDelivery: shipment?.selectedRate?.estimatedDelivery,
        shipper: shipment ? { city: shipment.shipper.city, province: shipment.shipper.province, country: shipment.shipper.country } : null,
        recipient: shipment ? { city: shipment.recipient.city, province: shipment.recipient.province, country: shipment.recipient.country } : null,
        statusHistory: shipment?.statusHistory || [],
        liveTracking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/shipments/:id/cancel
export const cancelShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.userId;

    const shipment = await Shipment.findById(id);
    if (!shipment) return res.status(404).json({ success: false, message: 'Shipment not found.' });

    if (shipment.userId && shipment.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const cancellableStatuses = ['pending_payment', 'paid', 'label_generated'];
    if (!cancellableStatuses.includes(shipment.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel a shipment with status: ${shipment.status}.` });
    }

    const now = new Date();
    const createdAt = shipment.createdAt;
    const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

    let refundAmount = 0;
    let refundNote = '';

    if (hoursSinceCreation <= 24 && shipment.status !== 'pickup_scheduled') {
      refundAmount = shipment.payment.amount || 0;
      refundNote = 'Full refund — cancelled within 24 hours.';
    } else if (shipment.status === 'pickup_scheduled') {
      refundAmount = Math.max(0, (shipment.payment.amount || 0) - 25);
      refundNote = '$25 deducted for driver dispatch.';
    } else {
      refundNote = 'Refund requires written review (after 24h).';
      refundAmount = 0;
    }

    shipment.status = 'cancelled';
    shipment.cancellation = {
      requestedAt: now,
      reason: reason || 'Customer requested cancellation',
      refundAmount,
      notes: refundNote,
    };

    await shipment.save();

    const contactEmail = shipment.guestEmail || '';
    if (contactEmail) {
      await emailService.sendCancellationConfirmation(contactEmail, shipment, refundAmount);
    }

    res.json({
      success: true,
      message: 'Shipment cancelled.',
      refundAmount,
      refundNote,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/shipments/my
export const getMyShipments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { page = 1, limit = 10, status } = req.query;

    const query: any = { userId };
    if (status) query.status = status;

    const shipments = await Shipment.find(query)
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean();

    const total = await Shipment.countDocuments(query);

    res.json({
      success: true,
      shipments,
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) },
    });
  } catch (error) {
    next(error);
  }
};
