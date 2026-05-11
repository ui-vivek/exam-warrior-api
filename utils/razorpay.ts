import Razorpay from 'razorpay';

let _instance: InstanceType<typeof Razorpay> | null = null;

export const getRazorpay = (): InstanceType<typeof Razorpay> => {
  if (!_instance) {
    _instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }
  return _instance;
};
