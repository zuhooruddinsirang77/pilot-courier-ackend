import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';

interface NetParcelAddress {
  Name: string;
  Company?: string;
  Address1: string;
  Address2?: string;
  City: string;
  Province: string;
  PostalCode: string;
  Country: string;
  Phone: string;
  Email?: string;
}

interface NetParcelParcel {
  Weight: number;
  WeightUnit: string;
  Length: number;
  Width: number;
  Height: number;
  DimensionUnit: string;
  Description: string;
  DeclaredValue?: number;
  Quantity: number;
}

interface NetParcelRateRequest {
  Origin: NetParcelAddress;
  Destination: NetParcelAddress;
  Parcels: NetParcelParcel[];
  ShipmentType?: string;
}

interface NetParcelRate {
  CarrierId: string;
  CarrierName: string;
  ServiceCode: string;
  ServiceName: string;
  TotalCharge: number;
  Currency: string;
  TransitDays?: number;
  EstimatedDelivery?: string;
}

class NetParcelService {
  private client: AxiosInstance;
  private username: string;
  private password: string;
  private baseUrl: string;
  private authToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.username = process.env.NETPARCEL_USERNAME || '';
    this.password = process.env.NETPARCEL_PASSWORD || '';
    this.baseUrl = process.env.NETPARCEL_API_URL || 'https://ship.netparcel.com/api';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  private async authenticate(): Promise<string> {
    if (this.authToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.authToken;
    }

    try {
      const response = await this.client.post('/authenticate', {
        username: this.username,
        password: this.password,
      });

      this.authToken = response.data.token || response.data.Token;
      this.tokenExpiry = new Date(Date.now() + 50 * 60 * 1000); // 50 minutes
      return this.authToken!;
    } catch (error) {
      logger.error('NetParcel authentication failed:', error);
      throw new Error('Failed to authenticate with NetParcel API');
    }
  }

  async getRates(data: NetParcelRateRequest): Promise<NetParcelRate[]> {
    try {
      const token = await this.authenticate();

      const response = await this.client.post('/rates', data, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const rates: NetParcelRate[] = response.data.Rates || response.data.rates || [];

      if (!rates.length) {
        logger.warn('No rates returned from NetParcel for given shipment details');
      }

      return rates;
    } catch (error: any) {
      logger.error('NetParcel getRates error:', error?.response?.data || error.message);
      throw new Error(error?.response?.data?.Message || 'Failed to fetch shipping rates');
    }
  }

  async createShipment(shipmentData: any): Promise<any> {
    try {
      const token = await this.authenticate();

      const response = await this.client.post('/shipments', shipmentData, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.data;
    } catch (error: any) {
      logger.error('NetParcel createShipment error:', error?.response?.data || error.message);
      throw new Error(error?.response?.data?.Message || 'Failed to create shipment with NetParcel');
    }
  }

  async getLabel(shipmentId: string): Promise<string> {
    try {
      const token = await this.authenticate();

      const response = await this.client.get(`/shipments/${shipmentId}/label`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
      });

      const base64Label = Buffer.from(response.data).toString('base64');
      return base64Label;
    } catch (error: any) {
      logger.error('NetParcel getLabel error:', error?.response?.data || error.message);
      throw new Error('Failed to retrieve shipping label');
    }
  }

  async trackShipment(trackingNumber: string): Promise<any> {
    try {
      const token = await this.authenticate();

      const response = await this.client.get(`/tracking/${trackingNumber}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.data;
    } catch (error: any) {
      logger.error('NetParcel trackShipment error:', error?.response?.data || error.message);
      throw new Error('Failed to retrieve tracking information');
    }
  }

  async cancelShipment(shipmentId: string): Promise<any> {
    try {
      const token = await this.authenticate();

      const response = await this.client.delete(`/shipments/${shipmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.data;
    } catch (error: any) {
      logger.error('NetParcel cancelShipment error:', error?.response?.data || error.message);
      throw new Error('Failed to cancel shipment with carrier');
    }
  }

  // Mock rates for development when API credentials not available
  getMockRates(originPostal: string, destPostal: string, weight: number): NetParcelRate[] {
    const basePrice = 12.99 + weight * 2.5;
    return [
      {
        CarrierId: 'UPS',
        CarrierName: 'UPS',
        ServiceCode: 'UPS_GROUND',
        ServiceName: 'UPS Ground',
        TotalCharge: parseFloat((basePrice + 0).toFixed(2)),
        Currency: 'CAD',
        TransitDays: 5,
        EstimatedDelivery: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
      },
      {
        CarrierId: 'FEDEX',
        CarrierName: 'FedEx',
        ServiceCode: 'FEDEX_EXPRESS',
        ServiceName: 'FedEx Express Saver',
        TotalCharge: parseFloat((basePrice + 8).toFixed(2)),
        Currency: 'CAD',
        TransitDays: 3,
        EstimatedDelivery: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      },
      {
        CarrierId: 'DHL',
        CarrierName: 'DHL',
        ServiceCode: 'DHL_EXPRESS',
        ServiceName: 'DHL Express',
        TotalCharge: parseFloat((basePrice + 15).toFixed(2)),
        Currency: 'CAD',
        TransitDays: 2,
        EstimatedDelivery: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      },
      {
        CarrierId: 'PUROLATOR',
        CarrierName: 'Purolator',
        ServiceCode: 'PUROLATOR_GROUND',
        ServiceName: 'Purolator Ground',
        TotalCharge: parseFloat((basePrice + 2).toFixed(2)),
        Currency: 'CAD',
        TransitDays: 4,
        EstimatedDelivery: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0],
      },
    ];
  }
}

export default new NetParcelService();
