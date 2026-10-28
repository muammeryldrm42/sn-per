// Fomo (the social trading app) pays the gas for its users: their transactions carry Fomo's relayer as fee payer
// (the user still signs). Address from Bitquery's on-chain research (docs.bitquery.io, "fomo api"), checked
// against live transactions; Fomo has not published it, so if Fomo changes it the Fomo counts go to zero
// instead of being wrong.
export const FOMO_RELAYER = "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
