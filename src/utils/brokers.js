const BALANZ_LOGO = '/balanz-logo.png';

export const BROKERS = [
  {
    id: 'jpm',
    name: 'Balanz Panamá',
    currency: 'USD',
    logo: BALANZ_LOGO,
  },
  {
    id: 'balanz',
    name: 'Balanz Capital',
    currency: 'ARS',
    logo: BALANZ_LOGO,
  },
  {
    id: 'one',
    name: 'One618',
    currency: 'ARS',
    logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj',
  },
  {
    id: 'latin',
    name: 'Latin Securities',
    currency: 'ARS',
    logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png',
  },
  {
    id: 'cocos',
    name: 'Cocos Capital',
    currency: 'ARS',
    logo: 'https://framerusercontent.com/images/CqHB1zzlyehXQqQTNPBthIsANBo.png',
  },
];

export const BROKER_MAP = Object.fromEntries(BROKERS.map((broker) => [broker.id, broker]));

export const createEmptyBrokerData = () =>
  Object.fromEntries(
    BROKERS.map((broker) => [
      broker.id,
      { balance: 0, assetsTotal: 0, debt: 0, updated: null },
    ])
  );

export const getBrokerName = (id) => BROKER_MAP[id]?.name || id;

export const isUsdBroker = (id) => BROKER_MAP[id]?.currency === 'USD';
