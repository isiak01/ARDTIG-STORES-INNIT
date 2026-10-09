import os
import re
from functools import wraps
from datetime import datetime, timezone

import cloudinary
import cloudinary.uploader
import firebase_admin
from firebase_admin import auth, credentials, firestore
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from urllib.parse import urlparse
from werkzeug.exceptions import RequestEntityTooLarge

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024

_firebase_app = None


def firebase_app():
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    if not os.getenv("FIREBASE_PROJECT_ID"):
        raise RuntimeError("Firebase server credentials are not configured.")

    if not firebase_admin._apps:
        private_key = os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
        service_account = {
            "type": "service_account",
            "project_id": os.environ["FIREBASE_PROJECT_ID"],
            "private_key": private_key,
            "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        firebase_admin.initialize_app(credentials.Certificate(service_account))

    _firebase_app = firebase_admin.get_app()
    return _firebase_app


def database():
    firebase_app()
    return firestore.client()


def authenticated(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        token = header[7:].strip() if header.startswith("Bearer ") else ""
        if not token:
            return jsonify(error="Sign in is required."), 401
        try:
            firebase_app()
            claims = auth.verify_id_token(token, check_revoked=True)
        except Exception:
            return jsonify(error="Your session is invalid or expired. Please sign in again."), 401
        profile = database().collection("users").document(claims["uid"]).get()
        if profile.exists and (profile.to_dict() or {}).get("banned") is True:
            return jsonify(error="This account was banned due to negative activities."), 403
        request.user_claims = claims
        return handler(*args, **kwargs)

    return wrapped


def cloudinary_ready():
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    if not all((cloud_name, api_key, api_secret)):
        raise RuntimeError("Cloudinary upload is not configured on the server.")
    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret, secure=True)


def public_member_data(profile):
    return {
        "username": profile.get("username", "PLAYER"),
        "photoURL": profile.get("photoURL", ""),
        "role": profile.get("role", "user"),
        "createdAt": profile.get("createdAt"),
        "adminSince": profile.get("adminSince", profile.get("createdAt")),
        "banned": profile.get("banned") is True,
    }


def write_user_notifications(db, user_ids, title, message):
    user_ids = list(dict.fromkeys(user_ids))
    for offset in range(0, len(user_ids), 450):
        batch = db.batch()
        for user_id in user_ids[offset:offset + 450]:
            reference = db.collection("notifications").document(user_id).collection("items").document()
            batch.set(reference, {
                "title": title,
                "message": message,
                "read": False,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
        batch.commit()


def caller_is_admin(db, user_id):
    profile = db.collection("users").document(user_id).get()
    return profile.exists and (profile.to_dict() or {}).get("role") == "admin"


def public_user_summary(user_id, profile):
    return {
        "uid": user_id,
        "username": profile.get("username", "PLAYER"),
        "photoURL": profile.get("photoURL", ""),
        "role": profile.get("role", "user"),
        "banned": profile.get("banned") is True,
    }


@app.get("/api/config")
def public_config():
    project_id = os.getenv("FIREBASE_PROJECT_ID", "")
    config = {
        "apiKey": os.getenv("FIREBASE_API_KEY", ""),
        "authDomain": f"{project_id}.firebaseapp.com" if project_id else "",
        "projectId": project_id,
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", ""),
        "appId": os.getenv("FIREBASE_APP_ID", ""),
    }
    missing = [key for key in ("apiKey", "authDomain", "projectId", "appId") if not config[key]]
    if missing:
        return jsonify(error="Firebase web configuration is incomplete.", missing=missing), 503
    return jsonify(firebase=config)


@app.post("/api/check-username")
@authenticated
def check_username():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    if not isinstance(username, str) or not re.fullmatch(r"[a-z0-9]{3,20}", username):
        return jsonify(error="Use 3 to 20 lowercase letters or numbers."), 400

    users = database().collection("usernames").document(username).get()
    return jsonify(available=not users.exists)


@app.post("/api/upload")
@authenticated
def upload_image():
    image = request.files.get("image")
    if image is None or not image.filename:
        return jsonify(error="Choose an image to upload."), 400
    image.stream.seek(0, os.SEEK_END)
    image_size = image.stream.tell()
    image.stream.seek(0)
    if image_size > 5 * 1024 * 1024:
        return jsonify(error="Images must be 5 MB or smaller."), 413
    if image.mimetype not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        return jsonify(error="Upload a JPG, PNG, WEBP, or GIF image."), 415

    try:
        cloudinary_ready()
        result = cloudinary.uploader.upload(
            image,
            folder="ardtig-stores",
            resource_type="image",
            allowed_formats=["jpg", "jpeg", "png", "webp", "gif"],
            overwrite=False,
        )
    except Exception as error:
        app.logger.exception("Cloudinary upload failed")
        return jsonify(error="Image upload failed. Check the upload configuration and try again."), 502

    return jsonify(url=result["secure_url"], publicId=result["public_id"]), 201


@app.post("/api/payment-request")
@authenticated
def create_payment_request():
    payload = request.get_json(silent=True) or {}
    account_type = payload.get("accountType")
    collection_by_type = {
        "freefire": "freefire_accounts",
        "cod": "cod_accounts",
        "efootball": "efootball_accounts",
        "diamonds": "diamonds",
    }
    account_id = payload.get("accountId")
    receipt_url = payload.get("receiptURL", "")
    price = payload.get("price")
    if not isinstance(account_type, str) or account_type not in collection_by_type or not isinstance(account_id, str) or not account_id:
        return jsonify(error="The listing details are invalid."), 400
    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
        return jsonify(error="The payment amount is invalid."), 400
    if not isinstance(receipt_url, str):
        return jsonify(error="Upload a valid payment proof image first."), 400
    receipt = urlparse(receipt_url)
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    if (
        receipt.scheme != "https"
        or receipt.netloc != "res.cloudinary.com"
        or not cloud_name
        or not receipt.path.startswith(f"/{cloud_name}/image/upload/")
        or "/ardtig-stores/" not in receipt.path
    ):
        return jsonify(error="Upload a valid payment proof image first."), 400

    try:
        db = database()
        user_id = request.user_claims["uid"]
        profile_snapshot = db.collection("users").document(user_id).get()
        listing_snapshot = db.collection(collection_by_type[account_type]).document(account_id).get()
        if not profile_snapshot.exists:
            return jsonify(error="Finish setting up your account before submitting a payment."), 403
        if not listing_snapshot.exists:
            return jsonify(error="This listing is no longer available."), 404
        profile = profile_snapshot.to_dict() or {}
        listing = listing_snapshot.to_dict()
        if listing.get("status") != "available" or float(listing.get("price", 0)) != float(price):
            return jsonify(error="The listing or its price changed. Refresh and try again."), 409

        payment = {
            "userId": user_id,
            "username": profile.get("username", ""),
            "userPhoto": profile.get("photoURL", ""),
            "userRole": profile.get("role", "user"),
            "accountId": account_id,
            "accountType": account_type,
            "receiptURL": receipt_url,
            "price": price,
            "status": "pending",
            "createdAt": firestore.SERVER_TIMESTAMP,
        }
        if account_type == "diamonds":
            player_uid = payload.get("uid", "")
            game_name = payload.get("gameName", "")
            if not isinstance(player_uid, str) or not player_uid.strip() or not isinstance(game_name, str) or not game_name.strip():
                return jsonify(error="Enter both your game UID and game name."), 400
            payment["uid"] = player_uid.strip()[:40]
            payment["gameName"] = game_name.strip()[:80]

        admins = list(db.collection("users").where("role", "==", "admin").stream())
        if not admins:
            return jsonify(error="Payment requests are temporarily unavailable because no administrators are configured."), 503

        payment_ref = db.collection("payment_requests").document()
        batch = db.batch()
        batch.set(payment_ref, payment)
        for admin in admins:
            notification_ref = db.collection("notifications").document(admin.id).collection("items").document()
            batch.set(notification_ref, {
                "title": "New payment request",
                "message": f"{payment['username']} submitted a {account_type} payment for ₦{price:,.0f}.",
                "read": False,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
        batch.commit()
        return jsonify(requestId=payment_ref.id, status="pending"), 201
    except Exception:
        app.logger.exception("Payment request creation failed")
        return jsonify(error="Your payment request could not be submitted."), 500


@app.post("/api/vote")
@authenticated
def toggle_category_vote():
    payload = request.get_json(silent=True) or {}
    category_id = payload.get("categoryId")
    if category_id not in {"freefire", "cod", "efootball", "diamonds"}:
        return jsonify(error="This category cannot be voted for."), 400

    try:
        db = database()
        user_id = request.user_claims["uid"]
        vote_ref = db.collection("votes").document(category_id)

        @firestore.transactional
        def toggle(transaction):
            snapshot = vote_ref.get(transaction=transaction)
            user_ids = snapshot.get("userIds") if snapshot.exists else []
            user_ids = list(user_ids or [])
            if user_id in user_ids:
                user_ids.remove(user_id)
                voted = False
            else:
                user_ids.append(user_id)
                voted = True
            transaction.set(vote_ref, {"userIds": user_ids, "updatedAt": firestore.SERVER_TIMESTAMP})
            return voted

        voted = toggle(db.transaction())
        return jsonify(voted=voted), 200
    except Exception:
        app.logger.exception("Vote update failed")
        return jsonify(error="Your vote could not be saved."), 500


@app.get("/api/votes")
def category_vote_summary():
    category_id = request.args.get("categoryId", "")
    if category_id not in {"freefire", "cod", "efootball", "diamonds"}:
        return jsonify(error="This category cannot be voted for."), 400

    try:
        snapshot = database().collection("votes").document(category_id).get()
        user_ids = snapshot.get("userIds") if snapshot.exists else []
        user_ids = list(user_ids or [])
        header = request.headers.get("Authorization", "")
        user_id = None
        if header.startswith("Bearer "):
            user_id = auth.verify_id_token(header[7:].strip(), check_revoked=True)["uid"]
        return jsonify(count=len(user_ids), voted=user_id in user_ids), 200
    except Exception:
        app.logger.exception("Vote summary could not be loaded")
        return jsonify(error="Vote totals could not be loaded."), 500


@app.post("/api/share")
def record_listing_share():
    payload = request.get_json(silent=True) or {}
    account_type = payload.get("accountType")
    account_id = payload.get("accountId")
    collection_by_type = {
        "freefire": "freefire_accounts",
        "cod": "cod_accounts",
        "efootball": "efootball_accounts",
        "diamonds": "diamonds",
    }
    if not isinstance(account_type, str) or account_type not in collection_by_type or not isinstance(account_id, str) or not account_id:
        return jsonify(error="The listing details are invalid."), 400

    try:
        db = database()
        listing_ref = db.collection(collection_by_type[account_type]).document(account_id)

        @firestore.transactional
        def increment_share(transaction):
            snapshot = listing_ref.get(transaction=transaction)
            if not snapshot.exists:
                return None
            listing = snapshot.to_dict() or {}
            if listing.get("status") != "available":
                return None
            shares = listing.get("shares", 0)
            if isinstance(shares, bool) or not isinstance(shares, int) or shares < 0:
                shares = 0
            shares += 1
            transaction.update(listing_ref, {"shares": shares})
            return shares

        shares = increment_share(db.transaction())
        if shares is None:
            return jsonify(error="This listing is no longer available."), 404
        return jsonify(shares=shares), 200
    except Exception:
        app.logger.exception("Listing share count could not be updated")
        return jsonify(error="The share count could not be updated."), 500


@app.post("/api/member-sync")
@authenticated
def sync_member_profile():
    try:
        db = database()
        user_id = request.user_claims["uid"]
        profile_snapshot = db.collection("users").document(user_id).get()
        if not profile_snapshot.exists:
            return jsonify(error="Finish setting up your account before opening the member directory."), 403
        profile = profile_snapshot.to_dict() or {}
        if not profile.get("username"):
            return jsonify(error="Finish setting up your account before opening the member directory."), 403
        db.collection("public_members").document(user_id).set(public_member_data(profile))
        return jsonify(role=profile.get("role", "user")), 200
    except Exception:
        app.logger.exception("Member profile sync failed")
        return jsonify(error="The member directory could not be refreshed."), 500


@app.post("/api/member-directory-sync")
@authenticated
def sync_member_directory():
    try:
        db = database()
        profiles = list(db.collection("users").stream())
        for offset in range(0, len(profiles), 450):
            batch = db.batch()
            for profile_snapshot in profiles[offset:offset + 450]:
                profile = profile_snapshot.to_dict() or {}
                if profile.get("username"):
                    batch.set(db.collection("public_members").document(profile_snapshot.id), public_member_data(profile))
            batch.commit()
        return jsonify(synced=len(profiles)), 200
    except Exception:
        app.logger.exception("Member directory sync failed")
        return jsonify(error="The member directory could not be refreshed."), 500


@app.get("/api/user-search")
@authenticated
def search_users_for_transfer():
    query_value = (request.args.get("q", "") or "").strip()
    if len(query_value) < 2:
        return jsonify(users=[]), 200
    try:
        db = database()
        matches = {}
        current_user = request.user_claims["uid"]

        for username_snapshot in db.collection("usernames").stream():
            username = str(username_snapshot.id).strip()
            if not username or query_value.casefold() not in username.casefold():
                continue
            user_id = (username_snapshot.to_dict() or {}).get("uid")
            if not isinstance(user_id, str) or user_id == current_user:
                continue
            profile_snapshot = db.collection("users").document(user_id).get()
            if not profile_snapshot.exists:
                continue
            profile = profile_snapshot.to_dict() or {}
            matches[user_id] = public_user_summary(user_id, profile)

        for profile_snapshot in db.collection("users").stream():
            profile = profile_snapshot.to_dict() or {}
            username = str(profile.get("username", "")).strip()
            if not username or profile_snapshot.id == current_user or profile_snapshot.id in matches:
                continue
            if query_value.casefold() in username.casefold():
                matches[profile_snapshot.id] = public_user_summary(profile_snapshot.id, profile)

        results = sorted(matches.values(), key=lambda item: item["username"].casefold())
        return jsonify(users=results[:12]), 200
    except Exception:
        app.logger.exception("User search for transfers failed")
        return jsonify(error="Users could not be searched."), 500


@app.post("/api/send-money")
@authenticated
def send_money_between_users():
    payload = request.get_json(silent=True) or {}
    receiver_id = payload.get("toUid")
    amount = payload.get("amount")
    if not isinstance(receiver_id, str) or not receiver_id.strip():
        return jsonify(error="Choose a valid member to send money to."), 400
    if not isinstance(amount, (int, float)) or isinstance(amount, bool) or float(amount) < 100 or not float(amount).is_integer():
        return jsonify(error="Enter an amount of at least ₦100."), 400

    sender_id = request.user_claims["uid"]
    if receiver_id == sender_id:
        return jsonify(error="You cannot send money to yourself."), 400

    amount = int(amount)
    fee = 100
    total = amount + fee
    try:
        db = database()
        sender_ref = db.collection("users").document(sender_id)
        receiver_ref = db.collection("users").document(receiver_id)

        @firestore.transactional
        def transfer_funds(transaction):
            sender_snapshot = sender_ref.get(transaction=transaction)
            receiver_snapshot = receiver_ref.get(transaction=transaction)
            if not sender_snapshot.exists or not receiver_snapshot.exists:
                return "missing"

            sender = sender_snapshot.to_dict() or {}
            receiver = receiver_snapshot.to_dict() or {}
            if sender.get("banned") is True or receiver.get("banned") is True:
                return "banned"

            sender_balance = sender.get("walletBalance", 0)
            receiver_balance = receiver.get("walletBalance", 0)
            if not isinstance(sender_balance, (int, float)) or isinstance(sender_balance, bool):
                sender_balance = 0
            if not isinstance(receiver_balance, (int, float)) or isinstance(receiver_balance, bool):
                receiver_balance = 0
            if sender_balance < total:
                return "insufficient"

            new_sender_balance = sender_balance - total
            new_receiver_balance = receiver_balance + amount
            transaction.update(sender_ref, {"walletBalance": new_sender_balance})
            transaction.update(receiver_ref, {"walletBalance": new_receiver_balance})

            transfer_ref = db.collection("transfers").document()
            transaction.set(transfer_ref, {
                "fromUid": sender_id,
                "fromUsername": sender.get("username", "PLAYER"),
                "toUid": receiver_id,
                "toUsername": receiver.get("username", "PLAYER"),
                "amount": amount,
                "fee": fee,
                "totalDeducted": total,
                "status": "completed",
                "createdAt": firestore.SERVER_TIMESTAMP,
            })

            sender_notification = db.collection("notifications").document(sender_id).collection("items").document()
            receiver_notification = db.collection("notifications").document(receiver_id).collection("items").document()
            transaction.set(sender_notification, {
                "title": "Wallet transfer sent",
                "message": f"You sent ₦{amount:,} to {receiver.get('username', 'PLAYER')}. Fee: ₦{fee:,}. New balance: ₦{new_sender_balance:,.2f}.",
                "read": False,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
            transaction.set(receiver_notification, {
                "title": "Wallet transfer received",
                "message": f"{sender.get('username', 'PLAYER')} sent you ₦{amount:,} ARDTIG balance! It has been added to your wallet.",
                "read": False,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
            return {"newBalance": new_sender_balance}

        result = transfer_funds(db.transaction())
        if result == "missing":
            return jsonify(error="The sender or recipient account could not be found."), 404
        if result == "banned":
            return jsonify(error="This transfer cannot be completed because one of the accounts is banned."), 403
        if result == "insufficient":
            return jsonify(error=f"Insufficient balance. You need ₦{total:,.2f} but your wallet is short."), 409
        return jsonify(status="completed", amount=amount, fee=fee, totalDeducted=total, newBalance=result["newBalance"]), 200
    except Exception:
        app.logger.exception("Wallet transfer failed")
        return jsonify(error="Transfer failed, please try again."), 500


@app.post("/api/ban-member")
@authenticated
def ban_member():
    payload = request.get_json(silent=True) or {}
    target_id = payload.get("userId")
    if not isinstance(target_id, str) or not target_id.strip():
        return jsonify(error="Choose a valid member."), 400
    try:
        db = database()
        if not caller_is_admin(db, request.user_claims["uid"]):
            return jsonify(error="Admin access is required."), 403
        target_ref = db.collection("users").document(target_id)
        target = target_ref.get()
        if not target.exists:
            return jsonify(error="This member could not be found."), 404
        target_data = target.to_dict() or {}
        target_ref.update({"banned": True, "banReason": "negative activities"})
        if target_data.get("username"):
            target_data.update({"banned": True, "banReason": "negative activities"})
            db.collection("public_members").document(target_id).set(public_member_data(target_data))
        return jsonify(banned=True), 200
    except Exception:
        app.logger.exception("Member ban failed")
        return jsonify(error="This member could not be banned."), 500


@app.get("/api/leaderboard")
@authenticated
def purchase_leaderboard():
    try:
        db = database()
        totals = {}
        for profile_snapshot in db.collection("users").stream():
            profile = profile_snapshot.to_dict() or {}
            total_topups = profile.get("totalTopups", 0)
            if isinstance(total_topups, (int, float)) and not isinstance(total_topups, bool) and total_topups > 0:
                totals[profile_snapshot.id] = {"freefire": 0, "cod": 0, "efootball": 0, "diamonds": 0, "totalPurchases": 0, "purchaseAmount": 0, "totalTopups": total_topups}
        requests = db.collection("payment_requests").where("status", "==", "approved").stream()
        for item in requests:
            payment = item.to_dict() or {}
            user_id = payment.get("userId")
            account_type = payment.get("accountType")
            if not user_id or account_type not in {"freefire", "cod", "efootball", "diamonds"}:
                continue
            entry = totals.setdefault(user_id, {"freefire": 0, "cod": 0, "efootball": 0, "diamonds": 0, "totalPurchases": 0, "purchaseAmount": 0, "totalTopups": 0})
            entry[account_type] += 1
            entry["totalPurchases"] += 1
            entry["purchaseAmount"] += payment.get("price", 0) if isinstance(payment.get("price", 0), (int, float)) else 0
        leaderboard = []
        for user_id, purchases in totals.items():
            profile = db.collection("users").document(user_id).get()
            data = profile.to_dict() or {} if profile.exists else {}
            score = purchases["purchaseAmount"] + purchases["totalTopups"]
            if score <= 0:
                continue
            leaderboard.append({
                "username": data.get("username", "PLAYER"),
                "photoURL": data.get("photoURL", ""),
                "role": data.get("role", "user"),
                "leaderboardScore": score,
                **purchases,
            })
        leaderboard.sort(key=lambda item: (-item["leaderboardScore"], item["username"].casefold()))
        return jsonify(entries=leaderboard), 200
    except Exception:
        app.logger.exception("Purchase leaderboard could not load")
        return jsonify(error="The leaderboard could not load."), 500


@app.post("/api/topup-request")
@authenticated
def create_topup_request():
    payload = request.get_json(silent=True) or {}
    amount = payload.get("amount")
    receipt_url = payload.get("receiptUrl", "")
    if not isinstance(amount, (int, float)) or isinstance(amount, bool) or amount < 1 or not float(amount).is_integer():
        return jsonify(error="Enter a valid whole-naira top-up amount."), 400
    if not isinstance(receipt_url, str):
        return jsonify(error="Upload a valid payment receipt first."), 400
    receipt = urlparse(receipt_url)
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    if receipt.scheme != "https" or receipt.netloc != "res.cloudinary.com" or not cloud_name or not receipt.path.startswith(f"/{cloud_name}/image/upload/") or "/ardtig-stores/" not in receipt.path:
        return jsonify(error="Upload a valid payment receipt first."), 400
    try:
        db = database()
        user_id = request.user_claims["uid"]
        profile_snapshot = db.collection("users").document(user_id).get()
        if not profile_snapshot.exists:
            return jsonify(error="Complete account setup before requesting a top-up."), 403
        profile = profile_snapshot.to_dict() or {}
        if not profile.get("username"):
            return jsonify(error="Complete account setup before requesting a top-up."), 403
        topup_ref = db.collection("topupRequests").document()
        topup_ref.set({
            "uid": user_id,
            "userId": user_id,
            "username": profile.get("username", "PLAYER"),
            "userRole": profile.get("role", "user"),
            "amount": int(amount),
            "receiptUrl": receipt_url,
            "status": "pending",
            "type": "wallet_topup",
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        admin_ids = [admin.id for admin in db.collection("users").where("role", "==", "admin").stream()]
        try:
            write_user_notifications(db, admin_ids, "Wallet top-up awaiting review", f"{profile.get('username', 'PLAYER')} requested a ₦{int(amount):,} wallet top-up.")
        except Exception:
            app.logger.exception("Admin top-up notification creation failed")
        return jsonify(requestId=topup_ref.id, status="pending"), 201
    except Exception:
        app.logger.exception("Wallet top-up request creation failed")
        return jsonify(error="Your top-up request could not be submitted."), 500


@app.post("/api/topup-review")
@authenticated
def review_topup_request():
    payload = request.get_json(silent=True) or {}
    request_id = payload.get("requestId")
    decision = payload.get("decision")
    if not isinstance(request_id, str) or not request_id or not isinstance(decision, str) or decision not in {"approve", "reject"}:
        return jsonify(error="The top-up review request is invalid."), 400
    try:
        db = database()
        if not caller_is_admin(db, request.user_claims["uid"]):
            return jsonify(error="Admin access is required."), 403
        request_ref = db.collection("topupRequests").document(request_id)
        topup_snapshot = request_ref.get()
        if not topup_snapshot.exists:
            return jsonify(error="This top-up request could not be found."), 404
        topup = topup_snapshot.to_dict() or {}
        user_id = topup.get("uid") or topup.get("userId")
        amount = topup.get("amount")
        if not isinstance(user_id, str) or not isinstance(amount, (int, float)) or isinstance(amount, bool) or amount <= 0:
            return jsonify(error="This top-up request has invalid details."), 400
        profile_ref = db.collection("users").document(user_id)
        notification_ref = db.collection("notifications").document(user_id).collection("items").document()

        @firestore.transactional
        def review(transaction):
            request_snapshot = request_ref.get(transaction=transaction)
            profile_snapshot = profile_ref.get(transaction=transaction)
            if not request_snapshot.exists or not profile_snapshot.exists:
                return "missing"
            request_data = request_snapshot.to_dict() or {}
            if request_data.get("status") != "pending":
                return "reviewed"
            profile = profile_snapshot.to_dict() or {}
            if decision == "approve":
                balance = profile.get("walletBalance", 0)
                total_topups = profile.get("totalTopups", 0)
                if not isinstance(balance, (int, float)) or isinstance(balance, bool) or balance < 0:
                    balance = 0
                if not isinstance(total_topups, (int, float)) or isinstance(total_topups, bool) or total_topups < 0:
                    total_topups = 0
                transaction.update(profile_ref, {"walletBalance": balance + amount, "totalTopups": total_topups + amount})
                status = "approved"
                title = "Wallet top-up approved"
                text = f"Your topup of ₦{amount:,.0f} was successful. Balance updated."
            else:
                status = "rejected"
                title = "Wallet top-up rejected"
                text = f"Your topup of ₦{amount:,.0f} was rejected. Please contact the store if you need help."
            transaction.update(request_ref, {"status": status, "reviewedAt": firestore.SERVER_TIMESTAMP})
            transaction.set(notification_ref, {"title": title, "message": text, "read": False, "createdAt": firestore.SERVER_TIMESTAMP})
            return status

        result = review(db.transaction())
        if result == "missing":
            return jsonify(error="This top-up request or user could not be found."), 404
        if result == "reviewed":
            return jsonify(error="This top-up request was already reviewed."), 409
        return jsonify(status=result), 200
    except Exception:
        app.logger.exception("Wallet top-up review failed")
        return jsonify(error="The top-up request could not be reviewed."), 500


@app.post("/api/wallet-purchase")
@authenticated
def purchase_with_wallet():
    payload = request.get_json(silent=True) or {}
    account_type = payload.get("accountType")
    account_id = payload.get("accountId")
    collection_by_type = {"freefire": "freefire_accounts", "cod": "cod_accounts", "efootball": "efootball_accounts", "diamonds": "diamonds"}
    if not isinstance(account_type, str) or account_type not in collection_by_type or not isinstance(account_id, str) or not account_id:
        return jsonify(error="The listing details are invalid."), 400
    try:
        db = database()
        user_id = request.user_claims["uid"]
        profile_ref = db.collection("users").document(user_id)
        account_ref = db.collection(collection_by_type[account_type]).document(account_id)
        player_uid = payload.get("uid", "")
        game_name = payload.get("gameName", "")
        if account_type == "diamonds" and (not isinstance(player_uid, str) or not player_uid.strip() or not isinstance(game_name, str) or not game_name.strip()):
            return jsonify(error="Enter both your UID and game name."), 400
        secret_ref = db.collection("account_secrets").document(account_id)
        payment_ref = db.collection("payment_requests").document()
        purchase_id = f"{user_id}_{account_id}"
        purchase_ref = db.collection("user_purchases").document(purchase_id)
        user_secret_ref = db.collection("account_secrets").document(purchase_id)
        account_log_ref = db.collection("accountLogs").document(purchase_id)
        sold_ref = db.collection("sold_accounts").document(account_id)
        notification_ref = db.collection("notifications").document(user_id).collection("items").document()

        @firestore.transactional
        def charge_wallet(transaction):
            profile_snapshot = profile_ref.get(transaction=transaction)
            account_snapshot = account_ref.get(transaction=transaction)
            secret_snapshot = secret_ref.get(transaction=transaction) if account_type != "diamonds" else None
            if not profile_snapshot.exists or not account_snapshot.exists:
                return "missing"
            profile = profile_snapshot.to_dict() or {}
            account = account_snapshot.to_dict() or {}
            if account.get("status") != "available":
                return "unavailable"
            price = account.get("price", 0)
            balance = profile.get("walletBalance", 0)
            if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
                return "invalid_price"
            if not isinstance(balance, (int, float)) or isinstance(balance, bool) or balance < price:
                return "insufficient"
            if account_type != "diamonds" and (not secret_snapshot or not secret_snapshot.exists):
                return "missing_secret"
            secret_data = secret_snapshot.to_dict() or {} if secret_snapshot else {}
            purchase_data = {
                "userId": user_id, "accountId": account_id, "accountType": account_type,
                "price": price, "status": "approved", "paymentMethod": "wallet",
                "createdAt": firestore.SERVER_TIMESTAMP,
            }
            if account_type == "diamonds":
                purchase_data.update({"uid": player_uid.strip()[:40], "gameName": game_name.strip()[:80]})
            transaction.update(profile_ref, {"walletBalance": balance - price})
            if account_type != "diamonds":
                transaction.update(account_ref, {"status": "sold"})
            transaction.set(payment_ref, {**purchase_data, "username": profile.get("username", "PLAYER")})
            if account_type != "diamonds":
                transaction.set(purchase_ref, {"userId": user_id, "accountId": account_id, "accountType": account_type, "status": "approved", "createdAt": firestore.SERVER_TIMESTAMP})
                transaction.set(user_secret_ref, {**secret_data, "uid": user_id, "accountId": account_id})
                transaction.set(account_log_ref, {"uid": user_id, "accountId": account_id, "accountType": account_type, "status": "approved", "createdAt": firestore.SERVER_TIMESTAMP, **secret_data})
                transaction.set(sold_ref, {**account, "id": account_id, "accountType": account_type, "status": "sold", "soldAt": firestore.SERVER_TIMESTAMP})
            else:
                transaction.set(account_log_ref, {"uid": user_id, "accountId": account_id, "accountType": account_type, "status": "approved", "gameName": game_name.strip()[:80], "gameUid": player_uid.strip()[:40], "createdAt": firestore.SERVER_TIMESTAMP})
            transaction.set(notification_ref, {"title": "Wallet purchase approved", "message": "Your wallet payment was successful. Go to My Accounts to view your account details.", "read": False, "createdAt": firestore.SERVER_TIMESTAMP})
            return {"requestId": payment_ref.id, "walletBalance": balance - price}

        result = charge_wallet(db.transaction())
        if result == "missing":
            return jsonify(error="The account or listing could not be found."), 404
        if result == "unavailable":
            return jsonify(error="This listing is no longer available."), 409
        if result == "invalid_price":
            return jsonify(error="This listing has an invalid price."), 400
        if result == "insufficient":
            return jsonify(error="Insufficient balance. Please topup wallet or pay with manual transfer."), 409
        if result == "missing_secret":
            return jsonify(error="Private delivery details are missing; checkout stopped."), 409
        return jsonify(**result, status="approved"), 201
    except Exception:
        app.logger.exception("Wallet purchase failed")
        return jsonify(error="Wallet payment could not be completed."), 500


@app.post("/api/tournament")
@authenticated
def create_tournament():
    payload = request.get_json(silent=True) or {}
    user_id = request.user_claims["uid"]
    try:
        db = database()
        if not caller_is_admin(db, user_id):
            return jsonify(error="Admin access is required."), 403
        game = payload.get("game", "Free Fire")
        map_name = payload.get("map", "")
        players_needed = payload.get("playersNeeded")
        match_type = payload.get("matchType", "")
        team_size = payload.get("teamSize", "")
        match_time = payload.get("matchTime", "")
        price = payload.get("price")
        price_type = payload.get("priceType", "")
        image_url = payload.get("imageUrl", "")
        if (
            not isinstance(game, str) or not game.strip() or len(game) > 40
            or not isinstance(map_name, str) or not map_name.strip() or len(map_name) > 80
            or not isinstance(players_needed, int) or isinstance(players_needed, bool) or players_needed < 1
            or not isinstance(match_type, str) or not match_type.strip() or len(match_type) > 60
            or team_size not in {"Solo", "Duo", "Squad"}
            or not isinstance(match_time, str) or not match_time.strip() or len(match_time) > 60
            or not isinstance(price, (int, float)) or isinstance(price, bool) or price < 0
            or not isinstance(price_type, str) or not price_type.strip() or len(price_type) > 40
            or not isinstance(image_url, str) or urlparse(image_url).scheme != "https" or urlparse(image_url).netloc != "res.cloudinary.com"
        ):
            return jsonify(error="Complete all tournament fields with valid values."), 400
        tournament_ref = db.collection("tournaments").document()
        tournament_ref.set({
            "game": game.strip(), "map": map_name.strip(), "playersNeeded": players_needed,
            "matchType": match_type.strip(), "teamSize": team_size, "matchTime": match_time.strip(),
            "price": price, "priceType": price_type.strip(), "imageUrl": image_url,
            "status": "upcoming", "roomCode": "", "roomPassword": "",
            "registeredUsers": [], "votes": 0, "createdAt": firestore.SERVER_TIMESTAMP,
        })
        user_ids = [profile.id for profile in db.collection("users").stream()]
        write_user_notifications(db, user_ids, "Upcoming tournament", "Free fire players!! there is an upcoming tournament for you! check the tournament page.")
        return jsonify(tournamentId=tournament_ref.id), 201
    except Exception:
        app.logger.exception("Tournament creation failed")
        return jsonify(error="The tournament could not be posted."), 500


@app.post("/api/tournament-register")
@authenticated
def register_tournament():
    payload = request.get_json(silent=True) or {}
    tournament_id = payload.get("tournamentId")
    if not isinstance(tournament_id, str) or not tournament_id.strip():
        return jsonify(error="Choose a valid tournament."), 400
    try:
        db = database()
        user_id = request.user_claims["uid"]
        profile_snapshot = db.collection("users").document(user_id).get()
        profile = profile_snapshot.to_dict() or {} if profile_snapshot.exists else {}
        if not profile.get("username"):
            return jsonify(error="Finish setting up your account before registering."), 403
        tournament_ref = db.collection("tournaments").document(tournament_id)
        registration_ref = db.collection("tournament_registrations").document(tournament_id).collection("registrants").document(user_id)
        registered_at = datetime.now(timezone.utc)

        @firestore.transactional
        def register(transaction):
            tournament = transaction.get(tournament_ref)
            if not tournament.exists:
                return "missing"
            if (tournament.to_dict() or {}).get("status") != "upcoming":
                return "closed"
            if transaction.get(registration_ref).exists:
                return "already"
            data = tournament.to_dict() or {}
            registrations = list(data.get("registeredUsers", []))
            registrations.append({"username": profile["username"], "role": profile.get("role", "user"), "time": registered_at})
            transaction.update(tournament_ref, {"registeredUsers": registrations})
            transaction.set(registration_ref, {"username": profile["username"], "role": profile.get("role", "user"), "time": registered_at})
            return "registered"

        result = register(db.transaction())
        if result == "missing":
            return jsonify(error="This tournament could not be found."), 404
        if result == "closed":
            return jsonify(error="Registration has closed for this tournament."), 409
        return jsonify(registered=result == "registered"), 200
    except Exception:
        app.logger.exception("Tournament registration failed")
        return jsonify(error="You could not register for this tournament."), 500


@app.post("/api/tournament-room")
@authenticated
def add_tournament_room():
    payload = request.get_json(silent=True) or {}
    tournament_id = payload.get("tournamentId")
    room_code = payload.get("roomCode")
    room_password = payload.get("roomPassword")
    if not isinstance(tournament_id, str) or not tournament_id or not isinstance(room_code, str) or not room_code.strip() or not isinstance(room_password, str) or not room_password.strip():
        return jsonify(error="Enter the tournament room code and password."), 400
    try:
        db = database()
        if not caller_is_admin(db, request.user_claims["uid"]):
            return jsonify(error="Admin access is required."), 403
        tournament_ref = db.collection("tournaments").document(tournament_id)

        @firestore.transactional
        def open_room(transaction):
            snapshot = transaction.get(tournament_ref)
            if not snapshot.exists:
                return "missing"
            if (snapshot.to_dict() or {}).get("status") != "upcoming":
                return "closed"
            transaction.update(tournament_ref, {"roomCode": room_code.strip(), "roomPassword": room_password.strip(), "status": "ongoing"})
            return "opened"

        result = open_room(db.transaction())
        if result == "missing":
            return jsonify(error="This tournament could not be found."), 404
        if result == "closed":
            return jsonify(error="Room details can only be added to an upcoming tournament."), 409
        recipients = [item.id for item in db.collection("tournament_registrations").document(tournament_id).collection("registrants").stream()]
        write_user_notifications(db, recipients, "Tournament room details are ready", "Tournament Room codes has been dropped, Go to the tournament page to get ROOM DETAILS.")
        return jsonify(status="ongoing"), 200
    except Exception:
        app.logger.exception("Tournament room update failed")
        return jsonify(error="The tournament room details could not be saved."), 500


@app.post("/api/tournament-finish")
@authenticated
def finish_tournament():
    payload = request.get_json(silent=True) or {}
    tournament_id = payload.get("tournamentId")
    if not isinstance(tournament_id, str) or not tournament_id:
        return jsonify(error="Choose a valid tournament."), 400
    try:
        db = database()
        if not caller_is_admin(db, request.user_claims["uid"]):
            return jsonify(error="Admin access is required."), 403
        reference = db.collection("tournaments").document(tournament_id)
        snapshot = reference.get()
        if not snapshot.exists:
            return jsonify(error="This tournament could not be found."), 404
        reference.update({"status": "finished"})
        return jsonify(status="finished"), 200
    except Exception:
        app.logger.exception("Tournament finish update failed")
        return jsonify(error="The tournament could not be marked finished."), 500


@app.route("/api", methods=["GET", "POST"])
def vercel_api_dispatch():
    endpoint_name = request.args.get("path", "").strip("/")
    endpoints = {
        "config": ("GET", public_config),
        "check-username": ("POST", check_username),
        "upload": ("POST", upload_image),
        "payment-request": ("POST", create_payment_request),
        "vote": ("POST", toggle_category_vote),
        "votes": ("GET", category_vote_summary),
        "share": ("POST", record_listing_share),
        "topup-request": ("POST", create_topup_request),
        "topup-review": ("POST", review_topup_request),
        "wallet-purchase": ("POST", purchase_with_wallet),
        "member-sync": ("POST", sync_member_profile),
        "member-directory-sync": ("POST", sync_member_directory),
        "user-search": ("GET", search_users_for_transfer),
        "send-money": ("POST", send_money_between_users),
        "ban-member": ("POST", ban_member),
        "leaderboard": ("GET", purchase_leaderboard),
        "tournament": ("POST", create_tournament),
        "tournament-register": ("POST", register_tournament),
        "tournament-room": ("POST", add_tournament_room),
        "tournament-finish": ("POST", finish_tournament),
    }
    endpoint = endpoints.get(endpoint_name)
    if endpoint is None:
        return jsonify(error="API route not found."), 404
    method, handler = endpoint
    if request.method != method:
        return jsonify(error="Method not allowed."), 405
    return handler()


@app.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
    return jsonify(error="Images must be 5 MB or smaller."), 413


@app.errorhandler(404)
def not_found(_error):
    return jsonify(error="API route not found."), 404


@app.errorhandler(500)
def server_error(_error):
    app.logger.exception("Unhandled API error")
    return jsonify(error="The server could not complete that request."), 500
