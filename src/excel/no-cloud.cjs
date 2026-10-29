// The upgraded unzipper has an optional S3 reader. It is outside this extension's
// in-memory export contract, so the build substitutes this explicit denial.
class CloudAccessDisabled {
  constructor() { throw new Error('E_XLSX_CLOUD_DISABLED'); }
}
module.exports = {GetObjectCommand: CloudAccessDisabled, HeadObjectCommand: CloudAccessDisabled};
