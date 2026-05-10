/**
 * Returns today's date in 'YYYY-MM-DD' format in Indian Standard Time (IST)
 */
export const getTodayIST = (): string => {
  const date = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC + 5:30
  const istDate = new Date(date.getTime() + istOffset);
  return istDate.toISOString().split('T')[0];
};

/**
 * Returns the start of today in IST as a Date object
 */
export const getTodayStart = (): Date => {
  const date = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  istDate.setUTCHours(0, 0, 0, 0);
  // Convert back to UTC for MongoDB queries
  return new Date(istDate.getTime() - istOffset);
};

/**
 * Returns yesterday's date in 'YYYY-MM-DD' format in IST
 */
export const getYesterdayIST = (): string => {
  const date = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  istDate.setUTCDate(istDate.getUTCDate() - 1);
  return istDate.toISOString().split('T')[0];
};
