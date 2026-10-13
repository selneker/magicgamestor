"""Frais de paiement provider-aware : FiveOne 2,75 % (min 100 / max 16 500) et Papi configurable."""
import pytest

from services import fees

FIVEONE = fees.DEFAULTS["fiveone"]


@pytest.mark.parametrize("amount,expected", [
    (2000, 100), (4000, 110), (4500, 124), (10000, 275), (50000, 1375),
    (100000, 2750), (500000, 13750), (600000, 16500), (1000000, 16500),
])
def test_fiveone_fee(amount, expected):
    assert fees.compute(FIVEONE, amount) == expected


def test_papi_defaults_to_fixed_min():
    assert fees.compute(fees.DEFAULTS["papi"], 50000) == 100


@pytest.mark.parametrize("amount", [2000, 4500, 100000])
def test_manual_ussd_is_free(amount):
    assert fees.compute(fees.MANUAL, amount) == 0
    assert fees.provider_key(None) == "manual"
    assert fees.provider_key("manual") == "manual"


def test_papi_percent_when_configured():
    assert fees.compute({"percent": 2.0, "min": 0, "max": 16500}, 10000) == 200


def test_provider_key_manual_uses_papi():
    assert fees.provider_key(None) == "manual"
    assert fees.provider_key("papi") == "papi"
    assert fees.provider_key("fiveone") == "fiveone"


def test_no_double_fee():
    fee = fees.compute(FIVEONE, 4500)
    assert 4500 + fee == 4624
