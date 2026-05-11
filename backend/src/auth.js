const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "chave_dev_troque_no_env";

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token não enviado." });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
}

module.exports = { createToken, authMiddleware };
