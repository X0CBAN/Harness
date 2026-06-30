package cert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Manager handles CA certificate generation and per-host cert caching.
type Manager struct {
	caCert    *x509.Certificate
	caKey     *ecdsa.PrivateKey
	certCache sync.Map // map[string]*tls.Certificate
	caPath    string
	keyPath   string
}

// NewManager loads or creates a CA certificate in the given directory.
func NewManager(dir string) (*Manager, error) {
	m := &Manager{
		caPath:  filepath.Join(dir, "harness-ca.crt"),
		keyPath: filepath.Join(dir, "harness-ca.key"),
	}
	if err := m.loadOrCreate(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) loadOrCreate() error {
	_, certErr := os.Stat(m.caPath)
	_, keyErr := os.Stat(m.keyPath)

	if certErr == nil && keyErr == nil {
		return m.load()
	}
	return m.create()
}

func (m *Manager) load() error {
	certPEM, err := os.ReadFile(m.caPath)
	if err != nil {
		return err
	}
	keyPEM, err := os.ReadFile(m.keyPath)
	if err != nil {
		return err
	}

	block, _ := pem.Decode(certPEM)
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return err
	}

	keyBlock, _ := pem.Decode(keyPEM)
	key, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return err
	}

	m.caCert = cert
	m.caKey = key
	return nil
}

func (m *Manager) create() error {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}

	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "Harness CA",
			Organization: []string{"Harness Proxy"},
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return err
	}

	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return err
	}

	// Persist to disk
	certFile, err := os.Create(m.caPath)
	if err != nil {
		return err
	}
	pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	certFile.Close()

	keyDER, _ := x509.MarshalECPrivateKey(key)
	keyFile, err := os.Create(m.keyPath)
	if err != nil {
		return err
	}
	pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	keyFile.Close()

	m.caCert = cert
	m.caKey = key
	return nil
}

// CACertPEM returns the CA cert in PEM format (used by goproxy internally).
func (m *Manager) CACertPEM() []byte {
	return pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: m.caCert.Raw,
	})
}

// CACertDER returns the raw DER bytes of the CA cert.
// Windows certificate import requires DER, not PEM.
func (m *Manager) CACertDER() []byte {
	return m.caCert.Raw
}

// CACertDERPath writes the cert as a DER file to the given path and returns it.
// Use this for Windows installs — double-clicking a DER .crt works correctly.
func (m *Manager) CACertDERPath(path string) error {
	return os.WriteFile(path, m.caCert.Raw, 0644)
}

// CAKeyPEM returns the CA private key in PEM format.
func (m *Manager) CAKeyPEM() []byte {
	keyDER, _ := x509.MarshalECPrivateKey(m.caKey)
	return pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: keyDER,
	})
}

// CATLSCertificate returns the CA as a tls.Certificate, parsed with its leaf —
// this is what goproxy needs to sign per-host certs on the fly.
func (m *Manager) CATLSCertificate() (tls.Certificate, error) {
	cert, err := tls.X509KeyPair(m.CACertPEM(), m.CAKeyPEM())
	if err != nil {
		return tls.Certificate{}, err
	}
	cert.Leaf = m.caCert
	return cert, nil
}

// TLSConfigForHost returns a tls.Config that presents a cert signed by our CA for the given host.
func (m *Manager) TLSConfigForHost(host string) (*tls.Config, error) {
	if cached, ok := m.certCache.Load(host); ok {
		tlsCert := cached.(tls.Certificate)
		return &tls.Config{Certificates: []tls.Certificate{tlsCert}}, nil
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}

	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}

	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: hostname},
		DNSNames:     []string{hostname},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, m.caCert, &key.PublicKey, m.caKey)
	if err != nil {
		return nil, err
	}

	keyDER, _ := x509.MarshalECPrivateKey(key)
	tlsCert, err := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}),
	)
	if err != nil {
		return nil, err
	}

	m.certCache.Store(host, tlsCert)
	return &tls.Config{Certificates: []tls.Certificate{tlsCert}}, nil
}
