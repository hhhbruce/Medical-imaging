"""Serve the VR PoC over HTTPS (WebXR requires a secure context on real headsets).

Generates a self-signed cert for localhost + your LAN IP, then serves the
current directory over TLS. Point your Quest/Pico browser at the printed URL.

Usage:
    python serve_https.py [port]   # default port 8443
"""
import datetime
import http.server
import ipaddress
import socket
import ssl
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
CERT = Path(__file__).parent / "cert.pem"
KEY = Path(__file__).parent / "key.pem"


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def make_cert(ip):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    san = x509.SubjectAlternativeName(
        [
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.IPAddress(ipaddress.ip_address(ip)),
        ]
    )
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=365))
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )
    KEY.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"generated self-signed cert for {ip}")


def main():
    ip = lan_ip()
    if not CERT.exists() or not KEY.exists():
        make_cert(ip)

    httpd = http.server.ThreadingHTTPServer(
        ("0.0.0.0", PORT), http.server.SimpleHTTPRequestHandler
    )
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(CERT), str(KEY))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print("HTTPS serving on:")
    print(f"  desktop:  https://localhost:{PORT}")
    print(f"  headset:  https://{ip}:{PORT}   (first visit: accept the cert warning)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
